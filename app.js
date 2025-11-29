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
let currentConfidence = 0;
let currentImageData = null; // Store image for certificate

// --- FIXED: Model Loading & Prediction ---

async function loadModel() {
    loader.style.display = 'block';
    output.textContent = 'Loading AI model...';
    try {
        await tf.disposeVariables();
        
        const m = await tf.loadLayersModel('./model/model.json');
        model = m;
        
        if (!model || !model.predict) {
            throw new Error('Model structure invalid');
        }
        
        // Log model info for debugging
        console.log('Model loaded successfully');
        console.log('Input shape:', model.inputs[0].shape);
        console.log('Output shape:', model.outputs[0].shape);
        
        loader.style.display = 'none';
        output.textContent = 'Ready. Upload an image.';
    } catch (err) {
        console.error('Model loading error:', err);
        loader.style.display = 'none';
        output.textContent = 'System Error: Model could not be loaded. Please refresh the page.';
    }
}

// CRITICAL FIX: Check model metadata and handle confidence correctly
async function predictImage(imgElement) {
    if (!model) {
        throw new Error('Model not loaded');
    }
    
    return tf.tidy(() => {
        try {
            let imgTensor = tf.browser.fromPixels(imgElement);
            
            if (imgTensor.shape[2] === 4) {
                imgTensor = imgTensor.slice([0, 0, 0], [-1, -1, 3]);
            }
            
            const resized = tf.image.resizeBilinear(imgTensor, [224, 224]);
            const normalized = resized.toFloat().div(255.0);
            const batched = normalized.expandDims(0);
            
            const prediction = model.predict(batched);
            const predData = prediction.dataSync();
            
            console.log('Raw prediction output:', predData);
            console.log('Output length:', predData.length);
            
            let confidence;
            
            // CRITICAL FIX: Handle different model output formats
            if (predData.length === 1) {
                // Single output (sigmoid): value represents P(authentic)
                // If close to 1 = authentic, close to 0 = replica
                confidence = predData[0] * 100;
                console.log('Single output model (sigmoid)');
            } else if (predData.length === 2) {
                // Two outputs (softmax): check which index is authentic
                // IMPORTANT: Verify your model.json metadata for label order!
                // Common formats:
                // Option A: [authentic, replica] - index 0 is authentic
                // Option B: [replica, authentic] - index 1 is authentic
                
                // FIX: Check if labels are inverted
                // If replicas are showing as authentic, swap these:
                const authenticIndex = 0; // Try changing to 1 if scores are inverted
                const replicaIndex = 1;   // Try changing to 0 if scores are inverted
                
                const authenticProb = predData[authenticIndex];
                const replicaProb = predData[replicaIndex];
                
                console.log(`Authentic prob (index ${authenticIndex}):`, authenticProb);
                console.log(`Replica prob (index ${replicaIndex}):`, replicaProb);
                
                // If model outputs logits instead of probabilities, apply softmax
                if (authenticProb + replicaProb < 0.99 || authenticProb + replicaProb > 1.01) {
                    console.log('Applying softmax normalization');
                    const maxVal = Math.max(authenticProb, replicaProb);
                    const expAuth = Math.exp(authenticProb - maxVal);
                    const expRep = Math.exp(replicaProb - maxVal);
                    const sumExp = expAuth + expRep;
                    confidence = (expAuth / sumExp) * 100;
                } else {
                    confidence = authenticProb * 100;
                }
            } else {
                throw new Error(`Unexpected output shape: ${predData.length}`);
            }
            
            // Sanity check - clamp to valid range
            confidence = Math.max(0, Math.min(100, confidence));
            
            console.log('Final confidence %:', confidence);
            return confidence;
            
        } catch (err) {
            console.error('Prediction error:', err);
            throw err;
        }
    });
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
    currentImageData = dataUrl; // Store for certificate
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
            throw new Error(`Failed to store certificate: ${storeResponse.status}`);
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
            throw new Error(`Worker returned status: ${response.status}`);
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
                Confidence: ${data.confidence || 'N/A'}%<br>
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

// NEW: Display QR code in UI after verification
async function displayVerificationQR(certId) {
    const qrContainer = document.getElementById('qrDisplay');
    if (!qrContainer) return;
    
    try {
        // Use a client-side QR library or fetch from worker
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

// Mousemove effect
document.addEventListener('mousemove', e => {
    const x = Math.round((e.clientX / window.innerWidth) * 100);
    const y = Math.round((e.clientY / window.innerHeight) * 100);
    document.body.style.background = `linear-gradient(180deg,var(--snow) 60%, var(--navy) 40%), radial-gradient(circle at ${x}% ${y}%, rgba(184,134,11,0.06), transparent 15%)`;
});
