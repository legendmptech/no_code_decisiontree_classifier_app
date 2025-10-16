import express from "express"
import multer from "multer"
import { parse } from "csv-parse/sync"
import { buildDecisionTree, predictWithTree } from "./utils.js";
import path from "path";

const app = express();
const PORT = 3000;

// Configure multer for file uploads
const upload = multer({ 
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed!'), false);
        }
    }
});

app.use(express.static('public'));
app.use(express.json());

app.get('/api/titles', (req, res) => {
    const titles = getTitles();
    res.json({titles});
});

// Expose last built tree (by latest timestamp folder)
import fs from "fs";
app.get('/api/tree/latest', (req, res) => {
    try {
        const treesDir = path.join(process.cwd(), 'trees');
        if (!fs.existsSync(treesDir)) return res.status(404).json({ error: 'No trees found' });
        const entries = fs.readdirSync(treesDir).filter(name => /\d+/.test(name));
        if (entries.length === 0) return res.status(404).json({ error: 'No trees found' });
        const latest = entries.sort((a,b)=> Number(b)-Number(a))[0];
        const treePath = path.join(treesDir, latest, 'tree.json');
        if (!fs.existsSync(treePath)) return res.status(404).json({ error: 'Tree file missing' });
        const json = JSON.parse(fs.readFileSync(treePath, 'utf8'));
        res.json({ success: true, tree: json, id: latest });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load tree', details: e.message });
    }
});

app.get('/api/tree/:id', (req, res) => {
    try {
        const id = req.params.id;
        const treePath = path.join(process.cwd(), 'trees', id, 'tree.json');
        if (!fs.existsSync(treePath)) return res.status(404).json({ error: 'Tree not found' });
        const json = JSON.parse(fs.readFileSync(treePath, 'utf8'));
        res.json({ success: true, tree: json, id });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load tree', details: e.message });
    }
});

// Predict endpoint: uses latest tree
app.post('/api/predict', express.json(), (req, res) => {
    try {
        const treesDir = path.join(process.cwd(), 'trees');
        if (!fs.existsSync(treesDir)) return res.status(404).json({ error: 'No trees found' });
        const targetId = (req.query && req.query.id) ? String(req.query.id) : null;
        const entries = fs.readdirSync(treesDir).filter(name => /\d+/.test(name));
        if (entries.length === 0) return res.status(404).json({ error: 'No trees found' });
        const chosen = targetId && fs.existsSync(path.join(treesDir, targetId))
            ? targetId
            : entries.sort((a,b)=> Number(b)-Number(a))[0];
        const treePath = path.join(treesDir, chosen, 'tree.json');
        if (!fs.existsSync(treePath)) return res.status(404).json({ error: 'Tree file missing' });
        const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
        const features = req.body || {};
        const result = predictWithTree(tree, features);
        res.json({ success: true, result, id: chosen });
    } catch (e) {
        res.status(500).json({ error: 'Prediction failed', details: e.message });
    }
});

// CSV upload and parsing endpoint
app.post('/api/upload-csv', upload.single('csvFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No CSV file uploaded' });
        }

        // Read and parse the CSV file
        const fs = await import('fs');
        const csvContent = fs.readFileSync(req.file.path, 'utf8');
        
        // Parse CSV data
        const records = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        // Print rows to console
        // console.log('CSV Data:');
        // console.log('Headers:', Object.keys(records[0] || {}));
        // records.forEach((row, index) => {
        //     console.log(`Row ${index + 1}:`, row);
        // });

        // Create data object in specified format
        const headers = Object.keys(records[0] || {});
        const classColumn = headers[headers.length - 1]; // Last column is class
        const featureColumns = headers.slice(0, -1); // All columns except last are features

        const data = {
            class: {
                category: [],
                count: {}
            },
            feature: {
                name: featureColumns
            }
        };

        // Process class column
        const classValues = records.map(row => row[classColumn]);
        const uniqueClassValues = [...new Set(classValues)];
        
        data.class.category = uniqueClassValues;
        uniqueClassValues.forEach(uniqueValue => {
            data.class.count[uniqueValue] = classValues.filter(value => value === uniqueValue).length;
        });

        // Process feature columns
        featureColumns.forEach(featureName => {
            const featureValues = records.map(row => row[featureName]);
            const uniqueFeatureValues = [...new Set(featureValues)];
            
            data.feature[featureName] = {
                category: uniqueFeatureValues,
                count: {}
            };

            // Count occurrences of each category in this feature
            uniqueFeatureValues.forEach(category => {
                data.feature[featureName].count[category] = 
                    featureValues.filter(value => value === category).length;
            });
        });

        // Build attr_data: per-feature -> per-feature-category -> per-class counts
        const attr_data = {};
        featureColumns.forEach(featureName => {
            const featureCategoryToClassCounts = {};
            records.forEach(row => {
                const featureCategory = row[featureName];
                const classCategory = row[classColumn];
                if (!featureCategoryToClassCounts[featureCategory]) {
                    featureCategoryToClassCounts[featureCategory] = {};
                }
                featureCategoryToClassCounts[featureCategory][classCategory] = 
                    (featureCategoryToClassCounts[featureCategory][classCategory] || 0) + 1;
            });
            attr_data[featureName] = featureCategoryToClassCounts;
        });

        data.attr_data = attr_data;

        // Console log the data object
        console.log('\n=== DATA OBJECT ===');
        console.log(JSON.stringify(data, null, 2));

        // Build decision tree and persist (internally computes gains)
        const id = String(Date.now());
        const modelName = req.body.modelName || `Model_${new Date().toLocaleDateString()}`;
        const tree = buildDecisionTree(records, { id });

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        // Prepare meta for UI
        const featureCategories = {};
        (data.feature.name || []).forEach(name => {
            featureCategories[name] = data.feature[name]?.category || [];
        });

        // Limit rows sent back for table preview
        const maxRows = 500;
        const previewRows = records.slice(0, maxRows);
        const previewHeaders = Object.keys(records[0] || {});

        // Store model metadata
        const modelMeta = {
            id,
            name: modelName,
            createdAt: new Date().toISOString(),
            featureCount: data.feature.name.length,
            classCount: data.class.category.length,
            totalRecords: records.length
        };
        
        // Save model metadata
        const metaPath = path.join(process.cwd(), 'trees', id, 'meta.json');
        fs.writeFileSync(metaPath, JSON.stringify(modelMeta, null, 2), 'utf8');

        // Return tree, meta and sample data
        res.json({ 
            success: true, 
            id,
            modelName,
            tree, 
            meta: { 
                classCounts: data.class.count, 
                featureNames: data.feature.name,
                featureCategories
            },
            table: { headers: previewHeaders, rows: previewRows, total: records.length }
        });

    } catch (error) {
        console.error('Error processing CSV:', error);
        res.status(500).json({ 
            error: 'Error processing CSV file',
            details: error.message 
        });
    }
});

// List all available tree model IDs on disk
app.get('/api/models', (req, res) => {
    try {
        const treesDir = path.join(process.cwd(), 'trees');
        if (!fs.existsSync(treesDir)) return res.json({ models: [] });
        const entries = fs.readdirSync(treesDir).filter(name => /\d+/.test(name));
        const models = [];
        
        for (const id of entries) {
            const metaPath = path.join(treesDir, id, 'meta.json');
            if (fs.existsSync(metaPath)) {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                models.push(meta);
            } else {
                // Fallback for old models without metadata
                models.push({ id, name: `Model_${id}`, createdAt: new Date(parseInt(id)).toISOString() });
            }
        }
        
        models.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ models });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list models', details: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});