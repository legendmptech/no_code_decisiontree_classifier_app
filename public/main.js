document.addEventListener('DOMContentLoaded', () => {
    const csvFileInput = document.getElementById('csvFile');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadSection = document.getElementById('uploadSection');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const loading = document.getElementById('loading');
    const messageContainer = document.getElementById('messageContainer');
    const resultsSection = document.getElementById('resultsSection');
    const modelSelect = document.getElementById('modelSelect');
    const loadModelBtn = document.getElementById('loadModelBtn');
    const tableHead = document.getElementById('tableHead');
    const tableBody = document.getElementById('tableBody');
    const predictForm = document.getElementById('predictForm');
    const predictBtn = document.getElementById('predictBtn');
    const predictModelSelect = document.getElementById('predictModelSelect');
    const predictResult = document.getElementById('predictResult');
    const modelNameInput = document.getElementById('modelName');
    const collapseAllBtn = document.getElementById('collapseAllBtn');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');

    let selectedFile = null;
    let latestMeta = null;
    let currentModelId = null;
    let featureCategories = {};
    let lastTree = null;
    let currentPage = 1;
    let pageSize = 50;
    let allTableData = null;

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            if (btn.dataset.tab === 'treeTab' && lastTree) {
                renderTree(lastTree);
            }
        });
    });

    // Prevent accidental reload/close
    window.addEventListener('beforeunload', (e) => {
        e.preventDefault();
        e.returnValue = '';
    });

    // Load saved models into selectors
    async function refreshModelSelectors() {
        try{
            const res = await fetch('/api/models');
            const json = await res.json();
            const models = json.models || [];
            const optionsHtml = models.map(model=>`<option value="${model.id}">${model.name}</option>`).join('');
            if(modelSelect){ modelSelect.innerHTML = optionsHtml; }
            if(predictModelSelect){ predictModelSelect.innerHTML = optionsHtml; }
        }catch{ /* ignore */ }
    }
    refreshModelSelectors();

    // Try to show something immediately: load latest tree if available
    (async function initLatestTree(){
        try{
            const res = await fetch('/api/tree/latest');
            const json = await res.json();
            if(res.ok && json.success){
                currentModelId = json.id;
                saveModelId(currentModelId);
                renderTree(json.tree);
                activateTab('treeTab');
            } else {
                // Inform user there's no saved model yet
                showMessage('No saved models found. Please upload a CSV to build a model.', 'error');
            }
        }catch(err){ showMessage('Could not load latest model. Upload a CSV to begin.', 'error'); }
    })();

    // File input change handler
    csvFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            selectedFile = file;
            fileName.textContent = file.name;
            fileSize.textContent = `(${formatFileSize(file.size)})`;
            fileInfo.style.display = 'block';
            uploadBtn.disabled = false;
            hideMessage();
        }
    });

    // Drag and drop functionality
    uploadSection.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadSection.classList.add('dragover');
    });

    uploadSection.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadSection.classList.remove('dragover');
    });

    uploadSection.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadSection.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
                csvFileInput.files = files;
                selectedFile = file;
                fileName.textContent = file.name;
                fileSize.textContent = `(${formatFileSize(file.size)})`;
                fileInfo.style.display = 'block';
                uploadBtn.disabled = false;
                hideMessage();
            } else {
                showMessage('Please select a CSV file.', 'error');
            }
        }
    });

    // Upload button click handler
    uploadBtn.addEventListener('click', () => {
        if (selectedFile) {
            uploadFile(selectedFile);
        }
    });

    // Upload file function
    async function uploadFile(file) {
        const formData = new FormData();
        formData.append('csvFile', file);
        formData.append('modelName', modelNameInput.value || `Model_${new Date().toLocaleDateString()}`);

        // Show loading state
        uploadBtn.disabled = true;
        loading.style.display = 'block';
        progressBar.style.display = 'block';
        hideMessage();

        // Simulate progress
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += Math.random() * 30;
            if (progress > 90) progress = 90;
            progressFill.style.width = progress + '%';
        }, 200);

        try {
            const response = await fetch('/api/upload-csv', {
                method: 'POST',
                body: formData
            });

            clearInterval(progressInterval);
            progressFill.style.width = '100%';

            const result = await response.json();

            if (response.ok && result.success) {
                showMessage(`Model "${result.modelName}" created successfully!`, 'success');
                latestMeta = result.meta || null;
                featureCategories = result.meta?.featureCategories || {};
                currentModelId = result.id;
                saveModelId(currentModelId);
                allTableData = result.table;
                renderTable(result.table);
                renderTree(result.tree);
                buildPredictForm(latestMeta);
                refreshModelSelectors();
            } else {
                showMessage(result.error || 'Error processing CSV file', 'error');
            }
        } catch (error) {
            clearInterval(progressInterval);
            showMessage('Network error: ' + error.message, 'error');
        } finally {
            // Hide loading state
            loading.style.display = 'none';
            progressBar.style.display = 'none';
            progressFill.style.width = '0%';
            uploadBtn.disabled = false;
        }
    }

    function renderTable(table) {
        if(!table) return;
        allTableData = table;
        currentPage = 1;
        renderTablePage();
        activateTab('dataTab');
    }

    function renderTablePage() {
        if(!allTableData) return;
        
        tableHead.innerHTML = '';
        tableBody.innerHTML = '';
        
        // Headers
        const headerRow = document.createElement('tr');
        (allTableData.headers||[]).forEach(h=>{ 
            const th=document.createElement('th'); 
            th.textContent=h; 
            headerRow.appendChild(th);
        });
        tableHead.appendChild(headerRow);

        // Pagination
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, allTableData.rows.length);
        const pageRows = allTableData.rows.slice(startIndex, endIndex);
        
        if(pageRows.length === 0){
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = (allTableData.headers||[]).length || 1;
            td.textContent = 'No rows to display.';
            tr.appendChild(td);
            tableBody.appendChild(tr);
        } else {
            pageRows.forEach(r=>{
                const tr = document.createElement('tr');
                (allTableData.headers||[]).forEach(h=>{ 
                    const td=document.createElement('td'); 
                    td.textContent = r[h]; 
                    tr.appendChild(td); 
                });
            tableBody.appendChild(tr);
        });
        }
        
        // Update pagination controls
        const totalPages = Math.ceil(allTableData.rows.length / pageSize);
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
        pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${allTableData.rows.length} total rows)`;
        
        const meta = document.getElementById('dataMeta');
        if(meta){ meta.textContent = `Showing rows ${startIndex + 1}-${endIndex} of ${allTableData.rows.length}`; }
    }

    function activateTab(id){
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b=>b.dataset.tab===id);
        if(btn) btn.classList.add('active');
        const pane = document.getElementById(id);
        if(pane) pane.classList.add('active');
    }

    function buildPredictForm(meta){
        if(!meta){ predictForm.innerHTML = '<div class="error-message">Meta not available. Build a tree first.</div>'; predictBtn.disabled = true; return; }
        predictForm.innerHTML = '';
        // Create inputs for each feature name using dropdowns
        meta.featureNames.forEach(name => {
            const wrapper = document.createElement('div');
            wrapper.style.margin = '8px 0';
            const label = document.createElement('label');
            label.textContent = name;
            label.style.display = 'block';
            const input = document.createElement('select');
            input.name = name;
            input.style.padding = '8px';
            input.style.width = '100%';
            input.style.border = '1px solid #ced4da';
            input.style.borderRadius = '8px';
            const opts = featureCategories[name] || [];
            input.innerHTML = opts.map(v=>`<option value="${v}">${v}</option>`).join('');
            wrapper.appendChild(label);
            wrapper.appendChild(input);
            predictForm.appendChild(wrapper);
        });
        predictBtn.disabled = false;
    }

    predictBtn && predictBtn.addEventListener('click', async () => {
        const payload = {};
        const inputs = predictForm.querySelectorAll('select');
        inputs.forEach(i => payload[i.name] = i.value);
        try{
            const modelId = predictModelSelect && predictModelSelect.value ? `?id=${predictModelSelect.value}` : '';
            const res = await fetch(`/api/predict${modelId}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
            const json = await res.json();
            if(res.ok && json.success){
                const probs = json.result.probabilities || {};
                const entries = Object.entries(probs).sort((a,b)=>b[1]-a[1]);
                predictResult.innerHTML = entries.map(([k,v])=> `${k}: ${(v*100).toFixed(2)}%`).join('<br/>');
            } else {
                predictResult.innerHTML = '<div class="error-message">Prediction failed.</div>';
            }
        }catch(err){
            predictResult.innerHTML = '<div class="error-message">Network error.</div>';
        }
    });

    // Load selected model id and render its tree
    loadModelBtn && loadModelBtn.addEventListener('click', async ()=>{
        const id = modelSelect && modelSelect.value;
        if(!id) return;
        try{
            const res = await fetch(`/api/tree/${id}`);
            const json = await res.json();
            if(res.ok && json.success){
                currentModelId = id;
                saveModelId(id);
                renderTree(json.tree);
                activateTab('treeTab');
            } else {
                showMessage('Selected model could not be loaded. Ensure its tree.json exists.', 'error');
            }
        } catch(err){
            showMessage('Failed to load selected model.', 'error');
        }
    });

    function saveModelId(id){
        const arr = JSON.parse(localStorage.getItem('myModels') || '[]');
        if(!arr.includes(id)){
            arr.push(id);
            localStorage.setItem('myModels', JSON.stringify(arr));
        }
    }

    // Render animated collapsible decision tree using D3
    function renderTree(serverTree) {
        if (!serverTree) return;
        const svg = d3.select('#treeSvg');
        svg.selectAll('*').remove();

        const container = document.getElementById('treeContainer');
        const width = container.clientWidth || 1200;
        const height = container.clientHeight || 600;

        const g = svg
            .attr('width', width)
            .attr('height', height)
            .append('g')
            .attr('transform', 'translate(50,50)');

        // Transform server tree into hierarchy for D3
        function toHierarchy(node, depth = 0) {
            if (!node) return { name: 'empty', depth };
            if (node.type === 'leaf') {
                const counts = node.classCounts || {};
                const secondary = Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(' | ');
                return { 
                    name: `${node.class ?? 'Leaf'}`, 
                    secondary,
                    depth,
                    isLeaf: true,
                    originalNode: node
                };
            }
            
            // Create intermediate feature node
            const featureNode = {
                name: node.feature || 'root',
                depth,
                isLeaf: false,
                isFeature: true,
                originalNode: node,
                children: []
            };
            
            // Add feature categories as children
            const children = (node.children || []).map(ch => {
                const child = toHierarchy(ch.subtree, depth + 2); // Skip one level for feature categories
                child.name = `${ch.value}`;
                child.parentFeature = node.feature;
                child.originalNode = ch.subtree;
                child.isFeatureCategory = true;
                return child;
            });
            
            featureNode.children = children;
            return featureNode;
        }

        lastTree = serverTree;
        const root = d3.hierarchy(toHierarchy(serverTree));

        // Add unique IDs to nodes
        let i = 0;
        root.eachBefore(d => d.id = i++);
        
        // Initially collapse all nodes except root
        root.children.forEach(collapse);
        function collapse(d) {
            if (d.children) {
                d._children = d.children;
                d._children.forEach(collapse);
                d.children = null;
            }
        }

        // Tree layout
        const treeLayout = d3.tree()
            .size([width - 100, height - 100])
            .separation((a, b) => (a.parent == b.parent ? 1 : 2) / a.depth);
        
        treeLayout(root);

        // Update function for animations
        function update(source) {
            const treeData = treeLayout(root);
            const nodes = treeData.descendants();
            const links = treeData.links();

            // Update nodes
        const node = g.selectAll('g.node')
                .data(nodes, d => d.id);

            const nodeEnter = node.enter().append('g')
            .attr('class', 'node')
                .attr('transform', d => `translate(${source.x0 || source.x},${source.y0 || source.y})`)
                .style('opacity', 0);

            // Add circles for the nodes
            nodeEnter.append('circle')
                .attr('r', d => d.data.isFeature ? 15 : 12)
                .attr('stroke', d => d.data.isFeature ? '#2c5aa0' : '#1f78b4')
                .attr('stroke-width', d => d.data.isFeature ? 3 : 2)
                .attr('fill', d => {
                    if (d.data.isLeaf) return '#fff7e6';
                    if (d.data.isFeature) return '#e3f2fd';
                    return '#eaf6ff';
                })
                .style('cursor', 'pointer');

            // Add labels for the nodes
            nodeEnter.append('text')
                .attr('dy', d => d.data.isFeature ? -25 : -20)
            .attr('text-anchor', 'middle')
                .style('font-size', d => d.data.isFeature ? '14px' : '12px')
                .style('font-weight', d => d.data.isFeature ? 700 : 600)
                .style('fill', d => d.data.isFeature ? '#0b3558' : '#0b3558')
            .text(d => d.data.name);

            // Add secondary labels only for leaf nodes
            nodeEnter.append('text')
                .attr('dy', d => d.data.isFeature ? 30 : 25)
            .attr('text-anchor', 'middle')
                .style('font-size', '10px')
            .style('fill', '#5b7b91')
                .text(d => d.data.isLeaf ? (d.data.secondary || '') : '');

            // Make all nodes clickable
            nodeEnter.on('click', click);

            // Update the node positions
            const nodeUpdate = nodeEnter.merge(node);
            nodeUpdate.transition()
                .duration(750)
                .attr('transform', d => `translate(${d.x},${d.y})`)
                .style('opacity', 1);

            // Remove any exiting nodes
            const nodeExit = node.exit().transition()
                .duration(750)
                .attr('transform', d => `translate(${source.x},${source.y})`)
                .style('opacity', 0)
                .remove();

            // Update the links
            const link = g.selectAll('path.link')
                .data(links, d => d.target.id);

            const linkEnter = link.enter().insert('path', 'g')
                .attr('class', 'link')
                .attr('fill', 'none')
                .attr('stroke', '#4facfe')
                .attr('stroke-width', 1.5)
                .attr('d', d => {
                    const o = {x: source.x0 || source.x, y: source.y0 || source.y};
                    return diagonal({source: o, target: o});
                })
                .style('opacity', 0);

            const linkUpdate = linkEnter.merge(link);
            linkUpdate.transition()
                .duration(750)
                .attr('d', d => diagonal(d))
                .style('opacity', 1);

            link.exit().transition()
                .duration(750)
                .attr('d', d => {
                    const o = {x: source.x, y: source.y};
                    return diagonal({source: o, target: o});
                })
                .style('opacity', 0)
                .remove();

            // No link labels needed since feature categories are now nodes

            // Store the old positions for transition
            nodes.forEach(d => {
                d.x0 = d.x;
                d.y0 = d.y;
            });
        }

        // Create the diagonal path generator
        const diagonal = d3.linkVertical()
            .x(d => d.x)
            .y(d => d.y);

        // Initial render using update function
        update(root);

        // Toggle children on click
        function click(event, d) {
            if (d.children) {
                d._children = d.children;
                d.children = null;
            } else {
                d.children = d._children;
                d._children = null;
            }
            update(d);
        }

        // Collapse all nodes function
        function collapseAllNodes() {
            root.children.forEach(collapse);
            function collapse(d) {
                if (d.children) {
                    d._children = d.children;
                    d._children.forEach(collapse);
                    d.children = null;
                }
            }
            // Re-render the tree after collapsing
            update(root);
        }

        // Store functions globally for external access
        window.collapseAllNodes = collapseAllNodes;
        window.treeUpdate = update;
    }

    // Helper functions for tree dimensions
    function getMaxDepth(node) {
        if (node.type === 'leaf') return 1;
        let maxChildDepth = 0;
        if (node.children) {
            for (const child of node.children) {
                maxChildDepth = Math.max(maxChildDepth, getMaxDepth(child.subtree));
            }
        }
        return 1 + maxChildDepth;
    }

    function getMaxWidth(node) {
        if (node.type === 'leaf') return 1;
        let totalWidth = 0;
        if (node.children) {
            for (const child of node.children) {
                totalWidth += getMaxWidth(child.subtree);
            }
        }
        return Math.max(1, totalWidth);
    }

    // Pagination event listeners
    prevPageBtn && prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTablePage();
        }
    });

    nextPageBtn && nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil((allTableData?.rows?.length || 0) / pageSize);
        if (currentPage < totalPages) {
            currentPage++;
            renderTablePage();
        }
    });

    // Collapse all button
    collapseAllBtn && collapseAllBtn.addEventListener('click', () => {
        if (window.collapseAllNodes) {
            window.collapseAllNodes();
        }
    });

    // Re-render tree on window resize if treeTab is active
    window.addEventListener('resize', () => {
        const treePane = document.getElementById('treeTab');
        if (treePane && treePane.classList.contains('active') && lastTree) {
            renderTree(lastTree);
        }
    });

    // Utility functions
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function showMessage(message, type) {
        messageContainer.innerHTML = `
            <div class="${type}-message">
                <i class="fas fa-${type === 'error' ? 'exclamation-triangle' : 'check-circle'}"></i>
                ${message}
            </div>
        `;
    }

    function hideMessage() {
        messageContainer.innerHTML = '';
    }
});