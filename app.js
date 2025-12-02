// --- Configuration ---
const WORKER_URL = 'https://api.opalforge.tech';
const APP_URL = 'https://opalforge.tech';

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
let currentConfidence = 0; // This stores AUTHENTIC confidence for certificate logic
let currentImageData = null;

// --- Model Loading (matches Netlify version) ---

async function loadModel() {
    loader.style.display = 'block';
    output.textContent = 'Loading model...';
    
    try {
        const m = await tf.loadLayersModel('./model/model.json');
        model = m;
        loader.style.display = 'none';
        output.textContent = 'Ready. Upload an image.';
        console.log('Model loaded successfully');
    } catch (err) {
        console.error('Model loading error:', err);
        loader.style.display = 'none';
        output.textContent = 'Error loading model. Please refresh the page.';
    }
}

// --- Prediction Logic (matches Netlify version exactly) ---

async function predictImage(imgElement) {
    try {
        const imgTensor = tf.browser.fromPixels(imgElement);
        const resized = tf.image.resizeBilinear(imgTensor, [224, 224]);
        const normalized = resized.toFloat().div(255).expandDims(0);
        const logits = model.predict(normalized);
        const data = await logits.data();
        
        console.log('Raw prediction data:', data);
        
        // Model outputs: [Authentic probability, Replica probability]
        // Index 0 = Authentic, Index 1 = Replica
        const authenticProb = data[0];
        const replicaProb = data[1];
        
        console.log(`Authentic: ${(authenticProb * 100).toFixed(2)}%, Replica: ${(replicaProb * 100).toFixed(2)}%`);
        
        // Clean up tensors
        imgTensor.dispose();
        resized.dispose();
        normalized.dispose();
        if (logits.dispose) logits.dispose();
        
        // Return both values
        return {
            authentic: authenticProb * 100,
            replica: replicaProb * 100
        };
    } catch (e) {
        console.error('Prediction error:', e);
        throw e;
    }
}

function showPreview(dataUrl) {
    imgPreview.hidden = false;
    imgPreview.innerHTML = '';
    const img = new Image();
    img.src = dataUrl;
    img.alt = 'Uploaded preview';
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
    if (!file) {
        output.textContent = 'No file selected.';
        return;
    }
    if (!model) {
        output.textContent = 'Model not loaded yet...';
        return;
    }

    loader.style.display = 'block';
    output.textContent = 'Processing image...';
    resultAction.style.display = 'none';

    const reader = new FileReader();
    reader.onload = async (ev) => {
        const dataUrl = ev.target.result;
        const img = showPreview(dataUrl);
        
        img.onload = async () => {
            try {
                const result = await predictImage(img);
                loader.style.display = 'none';
                
                // Store authentic confidence for certificate minting
                currentConfidence = result.authentic;
                
                // Display based on which is higher
                if (result.authentic > result.replica) {
                    // Item appears AUTHENTIC
                    output.innerHTML = `<span style="color:green">✓ Authentic (${result.authentic.toFixed(1)}%)</span>`;
                    if (result.authentic >= 85) {
                        resultAction.style.display = 'block';
                    } else {
                        resultAction.style.display = 'none';
                    }
                } else {
                    // Item appears to be REPLICA
                    output.innerHTML = `<span style="color:red">✗ Potential Replica (${result.replica.toFixed(1)}%)</span>`;
                    resultAction.style.display = 'none';
                }
            } catch (err) {
                console.error('Analysis failed:', err);
                loader.style.display = 'none';
                output.innerHTML = `<span style="color:red">Error processing image.</span>`;
            }
        };
        
        img.onerror = () => {
            loader.style.display = 'none';
            output.textContent = 'Error loading image.';
        };
    };
    
    reader.onerror = () => {
        loader.style.display = 'none';
        output.textContent = 'Error reading file.';
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
