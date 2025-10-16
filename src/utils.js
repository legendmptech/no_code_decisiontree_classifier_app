import fs from "fs";
import path from "path";

export function ENTROPY(n1,total) {
    if (!total || !n1) return 0;
    const p = n1 / total;
    return -p * Math.log2(p);
}

export function classifier(data) {
    const classCategories = data["class"]["category"]; // array of class labels
    let noOfRows = 0;
    for (const cat of classCategories) {
        noOfRows += data["class"]["count"][cat] || 0;
    }
    let totalEntropy = 0;
    for (const cat of classCategories) {
        totalEntropy += ENTROPY(data["class"]["count"][cat] || 0, noOfRows);
    }
    const feature_gain = {
        features: [],
        gain: {}
    };
    for (const featureName of data["feature"]["name"]) {
        feature_gain.features.push(featureName);
        let g = totalEntropy;
        for (const featCategory of data["feature"][featureName]["category"]) {
            const featCatCount = data['feature'][featureName]["count"][featCategory] || 0;
            if (featCatCount > 0) {
                for (const classCat of classCategories) {
                    const featCatClassCount = (data["attr_data"][featureName]?.[featCategory]?.[classCat]) || 0;
                    g -= (featCatCount / noOfRows) * ENTROPY(featCatClassCount, featCatCount);
                }
            }
        }
        feature_gain.gain[featureName] = g;
    }
    return feature_gain;
}

// Build the data object from a set of records (objects), assuming last column is class
export function buildDataObject(records) {
    if (!records || records.length === 0) {
        return { class: { category: [], count: {} }, feature: { name: [] }, attr_data: {} };
    }
    const headers = Object.keys(records[0] || {});
    const classColumn = headers[headers.length - 1];
    const featureColumns = headers.slice(0, -1);

    const data = {
        class: { category: [], count: {} },
        feature: { name: featureColumns },
        attr_data: {}
    };

    // Class counts
    const classValues = records.map(r => r[classColumn]);
    const uniqueClass = [...new Set(classValues)];
    data.class.category = uniqueClass;
    uniqueClass.forEach(c => { data.class.count[c] = classValues.filter(v => v === c).length; });

    // Feature categories and counts
    featureColumns.forEach(featureName => {
        const vals = records.map(r => r[featureName]);
        const uniq = [...new Set(vals)];
        data.feature[featureName] = { category: uniq, count: {} };
        uniq.forEach(cat => {
            data.feature[featureName].count[cat] = vals.filter(v => v === cat).length;
        });
    });

    // attr_data: feature -> featureCategory -> classCategory -> count
    featureColumns.forEach(featureName => {
        const map = {};
        records.forEach(row => {
            const fCat = row[featureName];
            const cCat = row[classColumn];
            if (!map[fCat]) map[fCat] = {};
            map[fCat][cCat] = (map[fCat][cCat] || 0) + 1;
        });
        data.attr_data[featureName] = map;
    });

    return data;
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function writeCsv(filePath, headers, rows) {
    const lines = [];
    lines.push(headers.join(","));
    for (const row of rows) {
        const line = headers.map(h => {
            const raw = row[h] ?? "";
            const s = String(raw);
            return s.includes(",") || s.includes('"') || s.includes("\n") ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(",");
        lines.push(line);
    }
    fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function isPure(records) {
    if (!records || records.length === 0) return true;
    const headers = Object.keys(records[0] || {});
    const classCol = headers[headers.length - 1];
    const classes = new Set(records.map(r => r[classCol]));
    return classes.size <= 1;
}

function removeFeatureFromRecords(records, featureName) {
    return records.map(r => {
        const clone = { ...r };
        delete clone[featureName];
        return clone;
    });
}

// Recursively build a decision tree, saving per-node subset CSVs and returning a JSON tree
export function buildDecisionTree(records, options = {}) {
    const id = options.id || String(Date.now());
    const baseDir = options.baseDir || path.join(process.cwd(), "trees", id);
    ensureDir(baseDir);

    const dataObj = buildDataObject(records);
    const classCounts = { ...dataObj.class.count };

    // Base cases: pure or no features left
    const headers = records[0] ? Object.keys(records[0]) : [];
    const classCol = headers[headers.length - 1];
    if (isPure(records) || dataObj.feature.name.length === 0) {
        const leafClass = records[0] ? records[0][classCol] : undefined;
        return { type: "leaf", class: leafClass, count: records.length, classCounts };
    }

    // Choose best feature by information gain
    const gains = classifier(dataObj);
    let bestFeature = null;
    let bestGain = -Infinity;
    for (const fname of gains.features) {
        const g = gains.gain[fname] ?? -Infinity;
        if (g > bestGain) {
            bestGain = g;
            bestFeature = fname;
        }
    }
    if (!bestFeature) {
        const leafClass = records[0] ? records[0][classCol] : undefined;
        return { type: "leaf", class: leafClass, count: records.length };
    }

    const node = { type: "node", feature: bestFeature, gain: bestGain, children: [], classCounts };

    // Split by bestFeature's categories
    const categories = dataObj.feature[bestFeature].category;
    const featureHeaders = Object.keys(records[0] || {});
    const csvHeaders = featureHeaders; // include the splitting feature in the saved CSV

    categories.forEach(cat => {
        const subset = records.filter(r => r[bestFeature] === cat);
        if (subset.length === 0) return;

        // Save subset CSV for this child
        const childDir = path.join(baseDir, bestFeature);
        ensureDir(childDir);
        const fileSafe = String(cat).replace(/[^a-zA-Z0-9_-]+/g, "_");
        const filePath = path.join(childDir, `${fileSafe}.csv`);
        writeCsv(filePath, csvHeaders, subset);

        // Recurse with feature removed
        const reduced = removeFeatureFromRecords(subset, bestFeature);
        const childTree = buildDecisionTree(reduced, { id, baseDir });
        node.children.push({ value: cat, subtree: childTree });
    });

    // Save tree snapshot at this point
    const treePath = path.join(baseDir, "tree.json");
    fs.writeFileSync(treePath, JSON.stringify(node, null, 2), "utf8");

    return node;
}

// Predict by traversing the stored tree; return class probabilities at the reached node
export function predictWithTree(tree, features) {
    let node = tree;
    while (node && node.type === 'node') {
        const value = features[node.feature];
        const child = (node.children || []).find(ch => String(ch.value) === String(value));
        if (!child) break; // unknown category, stop at current node
        node = child.subtree;
    }
    const counts = node && node.classCounts ? node.classCounts : {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const probabilities = {};
    for (const [k, v] of Object.entries(counts)) probabilities[k] = v / total;
    // most likely class
    let best = null, bestP = -1;
    for (const [k, p] of Object.entries(probabilities)) {
        if (p > bestP) { best = k; bestP = p; }
    }
    return { nodeType: node?.type || 'node', class: node?.class, probabilities, mostLikely: best };
}