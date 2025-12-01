// --- Configuration ---
const WORKER_URL = 'https://api.opalforge.tech';
const APP_URL = 'https://opalforge.tech';
const MODEL_URL = './model/';

// --- DOM Elements ---
const output = document.getElementById('output');
const loader = document.getElementById('loader');
const uploadButton = document.getElementById('upload');
const fileInput = document.getElementById('fileInput');
const imgPreview = document.getElementById('imgPreview');
const resultAction = document.getElementById('resultAction');
const mintButton = document.getElementById('mintButton');

const certIdInput = document.getElementById('certIdInput');
const verifyButton = document.getElementById('verifyButton');
const statusMessage = document.getElementById('statusMessage');

// Initial State
loader.style.display = 'none';
let model = null;
let currentConfidence = 0;
let currentImageData = null;

// --- Model Loading using Teachable Machine Library ---

async function loadModel() {
    loader.style.display = 'block';
    output.textContent = 'Loading AI model...';
    
    try {
        const modelURL = MODEL_URL + 'model.json';
        const metadataURL = MODEL_URL + 'metadata.json';
        
        // Use Teachable Machine library - handles preprocessing automatically
        model = await tmImage.load(modelURL, metadataURL);
        
        console.log('Model loaded successfully via Teachable Machine library');
        console.log('Total classes:', model.getTotalClasses());
        
        loader.style.display = 'none';
        output.textContent = 'Ready. Upload an image.';
        
    } catch (err) {
        console.error('Model loading error:', err);
        loader.style.display = 'none';
        output.textContent = 'System Error: Model could not be loaded. Please refresh the page.';
    }
}

// --- Prediction Logic using Teachable Machine ---

async function predictImage(imgElement) {
    if (!model) {
        throw new Error('Model not loaded');
    }
    
    try {
        // Teachable Machine library handles all preprocessing automatically
        const predictions = await model.predict(imgElement, false);
        
        console.log('Raw predictions:', predictions);
        
        // Find the "Verified Authentic" prediction
        let authenticProb = 0;
        let replicaProb = 0;
        
        for (const pred of predictions) {
            console.log(`Class: ${pred.className}, Probability: ${pred.probability.toFixed(4)}`);
            
            if (pred.className.toLowerCase().includes('authentic')) {
                authenticProb = pred.probability;
            } else if (pred.className.toLowerCase().includes('replica') || pred.className.toLowerCase().includes('counterfeit')) {
                replicaProb = pred.probability;
            }
        }
        
        // Convert to percentage (0-100)
        const confidence = authenticProb * 100;
        
        console.log(`Authentic: ${authenticProb.toFixed(4)}, Replica: ${replicaProb.toFixed(4)}`);
        console.log(`Final confidence: ${confidence.toFixed(1)}% authentic`);
        
        return confidence;
        
    } catch (err) {
        console.error('Prediction error:', err);
        throw err;
    }
}

function showPreview(dataUrl) {
    imgPreview.hidden = false;
    imgPreview.innerHTML = '';
    const img = new Image();
    img.src = dataUrl;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    imgPreview.appendChild(img);
    currentImageData = dataUrl;
    return img;
}

// --- Certificate Logic ---

async function mintCertificate() {
    if (currentConfidence < 85) {
        alert("Authentication score is too low to mint certificate (Requires 85% or higher).");
        return;
    }

    const newCertId = 'OF-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    const qrPayload = `${APP_URL}/?verify=${newCertId}`;

    statusMessage.textContent = 'Minting Certificate...';
    mintButton.disabled = true;
    mintButton.textContent = "Processing...";

    try {
        // First, store the certificate in the database
        const storeResponse = await fetch(`${WORKER_URL}/certificate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                certId: newCertId,
                confidence: currentConfidence,
                timestamp: new Date().toISOString(),
                qrPayload: qrPayload
            })
        });

        if (!storeResponse.ok) {
            const errText = await storeResponse.text();
            throw new Error(`Failed to store certificate: ${storeResponse.status} - ${errText}`);
        }

        // Then generate and download the PDF
        const pdfUrl = `${WORKER_URL}/certificate/${newCertId}/pdf?qrData=${encodeURIComponent(qrPayload)}&confidence=${currentConfidence.toFixed(1)}`;
        
        const response = await fetch(pdfUrl, { method: 'GET' });

        if (response.ok) {
            const blob = await response.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `OpalForge_Cert_${newCertId}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            output.textContent = `Certificate Minted! ID: ${newCertId}`;
            statusMessage.innerHTML = `<span style="color: green;">✓ Download started. Certificate ID: <strong>${newCertId}</strong></span>`;
            
            // Show the certificate ID for user reference
            certIdInput.value = newCertId;
        } else {
            throw new Error(`PDF generation failed: ${response.status}`);
        }
    } catch (e) {
        console.error('Minting error:', e);
        statusMessage.innerHTML = `<span style="color: red;">Minting failed: ${e.message}</span>`;
    } finally {
        mintButton.disabled = false;
        mintButton.textContent = "Mint Certificate";
    }
}

async function verifyCertificate(certId) {
    const trimmedId = certId.trim().toUpperCase();
    
    if (!trimmedId) {
        statusMessage.style.color = 'orange';
        statusMessage.textContent = 'Please enter a Certificate ID to verify.';
        return;
    }
    
    // Validate format
    if (!trimmedId.startsWith('OF-') || trimmedId.length < 5) {
        statusMessage.style.color = 'orange';
        statusMessage.textContent = 'Invalid certificate format. IDs start with "OF-"';
        return;
    }
    
    statusMessage.textContent = `Verifying ID: ${trimmedId}...`;
    certIdInput.value = trimmedId;

    try {
        const url = `${WORKER_URL}/certificate/${trimmedId}`;
        const response = await fetch(url, { method: 'GET' });

        if (response.ok) {
            const data = await response.json();
            statusMessage.style.color = 'green';
            statusMessage.innerHTML = `
                ✅ <strong>Verified Authentic</strong><br>
                ID: ${trimmedId}<br>
                Confidence: ${data.confidence ? data.confidence.toFixed(1) : 'N/A'}%<br>
                Issued: ${data.timestamp ? new Date(data.timestamp).toLocaleDateString() : 'N/A'}
            `;
            output.textContent = "Certificate Verified";
            
            // Show QR code for the verified certificate
            displayVerificationQR(trimmedId);
        } else if (response.status === 404) {
            statusMessage.style.color = 'red';
            statusMessage.textContent = '❌ Certificate Not Found';
        } else {
            throw new Error(`Verification failed: ${response.status}`);
        }
    } catch (e) {
        console.error('Verification error:', e);
        statusMessage.style.color = 'red';
        statusMessage.textContent = `Verification error: ${e.message}`;
    }
}

async function displayVerificationQR(certId) {
    const qrContainer = document.getElementById('qrDisplay');
    if (!qrContainer) return;
    
    try {
        const qrUrl = `${WORKER_URL}/qr/${certId}`;
        const response = await fetch(qrUrl);
        
        if (response.ok) {
            const blob = await response.blob();
            const imgUrl = URL.createObjectURL(blob);
            qrContainer.innerHTML = `<img src="${imgUrl}" alt="Certificate QR Code" style="width: 150px; height: 150px;">`;
            qrContainer.style.display = 'block';
        }
    } catch (e) {
        console.error('QR display error:', e);
    }
}

// --- Event Listeners ---

uploadButton.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    loader.style.display = 'block';
    output.textContent = 'Analyzing...';
    resultAction.style.display = 'none';

    const reader = new FileReader();
    reader.onload = async (ev) => {
        const img = showPreview(ev.target.result);
        img.onload = async () => {
            try {
                currentConfidence = await predictImage(img);
                loader.style.display = 'none';
                
                if (currentConfidence >= 85) {
                    output.innerHTML = `<span style="color:green">✓ Authentic (${currentConfidence.toFixed(1)}%)</span>`;
                    resultAction.style.display = 'block';
                } else if (currentConfidence >= 50) {
                    output.innerHTML = `<span style="color:orange">⚠ Uncertain (${currentConfidence.toFixed(1)}%)</span>`;
                    resultAction.style.display = 'none';
                } else {
                    output.innerHTML = `<span style="color:red">✗ Potential Replica (${currentConfidence.toFixed(1)}%)</span>`;
                    resultAction.style.display = 'none';
                }
            } catch (err) {
                console.error('Analysis failed:', err);
                loader.style.display = 'none';
                output.innerHTML = `<span style="color:red">Analysis Error. Please try again.</span>`;
            }
        };
    };
    reader.readAsDataURL(file);
});

mintButton.addEventListener('click', mintCertificate);

verifyButton.addEventListener('click', () => {
    verifyCertificate(certIdInput.value.trim());
});

// --- Initialization ---

window.addEventListener('load', async () => {
    await loadModel();

    const urlParams = new URLSearchParams(window.location.search);
    const verifyId = urlParams.get('verify');

    if (verifyId) {
        console.log("QR Code scan detected:", verifyId);
        const verifySection = document.getElementById('verifySection');
        if (verifySection) {
            verifySection.scrollIntoView({ behavior: 'smooth' });
        }
        verifyCertificate(verifyId);
    }
});

// Mousemove glow effect - uses a separate overlay instead of changing body background
// (Removed to fix white strip issue - the glow div already provides ambient effect)
