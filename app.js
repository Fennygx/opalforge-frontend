// =========================================================
// SECTION A: TENSORFLOW AI MODEL LOGIC (Existing Code)
// =========================================================

// Global Elements
const output = document.getElementById('output');
const loader = document.getElementById('loader');
const uploadButton = document.getElementById('upload');
const fileInput = document.getElementById('fileInput');
const imgPreview = document.getElementById('imgPreview');
loader.style.display = 'none';

let model = null;

async function loadModel() {
    loader.style.display = 'block';
    output.textContent = 'Loading model...';
    try {
        const m = await tf.loadLayersModel('./model.json');
        model = m;
        loader.style.display = 'none';
        output.textContent = 'Model loaded. Upload an image to start.';
    } catch (err) {
        loader.style.display = 'none';
        output.textContent = 'Error loading model. Ensure model.json and weights are hosted and accessible via HTTP(S).';
    }
}

async function predictImage(imgElement) {
    try {
        const imgTensor = tf.browser.fromPixels(imgElement);
        const resized = tf.image.resizeBilinear(imgTensor, [224, 224]);
        const normalized = resized.toFloat().div(255).expandDims(0);
        const logits = model.predict(normalized);
        const data = await logits.data();
        const confidence = Math.max(...data) * 100;
        imgTensor.dispose(); resized.dispose(); normalized.dispose();
        if (logits.dispose) logits.dispose();
        return confidence;
    } catch (e) {
        throw e;
    }
}

function showPreview(dataUrl) {
    imgPreview.hidden = false; imgPreview.innerHTML = '';
    const img = new Image(); img.src = dataUrl; img.alt = 'Uploaded preview'; img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'cover'; imgPreview.appendChild(img);
}


// =========================================================
// SECTION B: CERTIFICATE GENERATION LOGIC (New Code)
// =========================================================

const WORKER_URL = 'https://opalforge-cert-gen.garcia-fenny.workers.dev';

async function generateCertificatePDF() {
    const certIdInput = document.getElementById('certIdInput');
    const statusMessage = document.getElementById('statusMessage'); 
    
    // 1. Input Validation and Feedback
    const certId = certIdInput.value.trim();
    if (!certId) {
        statusMessage.textContent = 'Please enter a Certificate ID.';
        statusMessage.style.color = 'red';
        return;
    }
    
    statusMessage.textContent = 'Generating certificate... Please wait.';
    statusMessage.style.color = '#00c6ff'; // Light blue for progress
    
    try {
        // 2. Worker API Call (POST request)
        const response = await fetch(WORKER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/pdf'
            },
            body: JSON.stringify({
                certificate_id: certId
            })
        });

        // 3. Error Handling and Response Check
        if (response.status === 400) {
            const errorJson = await response.json();
            throw new Error(`Invalid Request: ${errorJson.message}`);
        }
        if (!response.ok) {
            const errorText = await response.text();
            // Try to parse the error message from the worker, otherwise use status text
            let displayError = response.statusText;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.message) displayError = errorJson.message;
            } catch (e) {
                // If parsing failed, use the response status text
            }
            throw new Error(`PDF Generation Failed: ${displayError}`);
        }

        // 4. Download Trigger (Success)
        const pdfBlob = await response.blob();
        
        // Extract filename from the Content-Disposition header
        let filename = `OpalForge_Cert_${certId}.pdf`; 
        const disposition = response.headers.get('Content-Disposition');
        if (disposition && disposition.indexOf('filename=') !== -1) {
            // Clean up the quotes from the header value
            filename = disposition.split('filename=')[1].replace(/"/g, '');
        }

        // Trigger the download
        const url = window.URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url); 

        statusMessage.textContent = `Certificate successfully generated and downloaded!`;
        statusMessage.style.color = '#00ffaa'; 

    } catch (error) {
        // 5. Final Error Feedback to User
        console.error('Certificate Generation Error:', error);
        statusMessage.textContent = `ERROR: ${error.message}`;
        statusMessage.style.color = 'red';
    }
}


// =========================================================
// SECTION C: EVENT LISTENERS (Both Features)
// =========================================================

// Existing AI Model Listeners
uploadButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) { output.textContent = 'No file selected.'; return }
    if (!model) { output.textContent = 'Model not loaded yet...'; return }
    loader.style.display = 'block'; output.textContent = 'Processing image...';
    const reader = new FileReader();
    reader.onload = async (ev) => {
        const dataUrl = ev.target.result;
        showPreview(dataUrl);
        const img = new Image(); img.src = dataUrl; img.onload = async () => {
            try {
                const conf = await predictImage(img);
                output.textContent = `Confidence: ${conf.toFixed(2)}% Replica`;
            } catch (err) { output.textContent = 'Error processing image.' }
            loader.style.display = 'none';
        };
        img.onerror = () => { loader.style.display = 'none'; output.textContent = 'Error loading image.' };
    };
    reader.onerror = () => { loader.style.display = 'none'; output.textContent = 'Error reading file.' };
    reader.readAsDataURL(file);
});


// New Certificate Listener (Attached to the new button)
document.addEventListener('DOMContentLoaded', () => {
    const generateButton = document.getElementById('generateButton');
    if (generateButton) {
        generateButton.addEventListener('click', generateCertificatePDF);
    }
});

// Existing Load and Mousemove Listeners
window.addEventListener('load', async () => {
    await loadModel();
});

document.addEventListener('mousemove', e => {
    const xRatio = e.clientX / window.innerWidth; const yRatio = e.clientY / window.innerHeight;
    const xPos = Math.round(xRatio * 100); const yPos = Math.round(yRatio * 100);
    document.body.style.background = `linear-gradient(180deg,var(--snow) 60%, var(--navy) 40%), radial-gradient(circle at ${xPos}% ${yPos}%, rgba(184,134,11,0.06), transparent 15%)`;
});
