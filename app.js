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

// --- CRITICAL FIX: Model Loading & Prediction ---

async function loadModel() {
    loader.style.display = 'block';
    output.textContent = 'Loading AI model...';
    try {
        // Clear any cached corrupted model
        await tf.disposeVariables();
        
        // Load fresh model instance
        const m = await tf.loadLayersModel('./model/model.json');
        model = m;
        
        // Validate model loaded correctly
        if (!model || !model.predict) {
            throw new Error('Model structure invalid');
        }
        
        loader.style.display = 'none';
        output.textContent = 'Ready. Upload an image.';
        console.log('Model loaded successfully');
    } catch (err) {
        console.error('Model loading error:', err);
        loader.style.display = 'none';
        output.textContent = 'System Error: Model could not be loaded. Please refresh the page.';
    }
}

// CRITICAL FIX: Proper image preprocessing & prediction
async function predictImage(imgElement) {
    if (!model) {
        throw new Error('Model not loaded');
    }
    
    return tf.tidy(() => {
        try {
            // Convert image to tensor
            let imgTensor = tf.browser.fromPixels(imgElement);
            
            // Ensure RGB (remove alpha channel if present)
            if (imgTensor.shape[2] === 4) {
                imgTensor = imgTensor.slice([0, 0, 0], [-1, -1, 3]);
            }
            
            // Resize to model's expected input (typically 224x224)
            const resized = tf.image.resizeBilinear(imgTensor, [224, 224]);
            
            // Normalize to [0, 1] range
            const normalized = resized.toFloat().div(255.0);
            
            // Add batch dimension
            const batched = normalized.expandDims(0);
            
            // Run prediction
            const prediction = model.predict(batched);
            
            // Get raw prediction values
            const predData = prediction.dataSync();
            
            // CRITICAL: Proper confidence calculation
            // Model outputs [authentic_prob, replica_prob] based on metadata.json labels
            const authenticProb = predData[0]; // First value is authentic
            const replicaProb = predData[1]; // Second value is replica
            
            // Convert to percentage (0-100)
            const confidence = authenticProb * 100;
            
            console.log('Raw prediction:', predData);
            console.log('Authentic probability:', authenticProb);
            console.log('Confidence %:', confidence);
            
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
        const url = `${WORKER_URL}/certificate/${newCertId}?qrData=${encodeURIComponent(qrPayload)}`;
        
        const response = await fetch(url, { method: 'GET' });

        if (response.ok) {
            const blob = await response.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `OpalForge_Cert_${newCertId}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            output.textContent = `Certificate Minted! ID: ${newCertId}`;
            statusMessage.textContent = 'Download started.';
        } else {
            throw new Error(`Worker returned status: ${response.status}`);
        }
    } catch (e) {
        console.error(e);
        statusMessage.textContent = 'Minting failed. API or network error.';
    } finally {
        mintButton.disabled = false;
        mintButton.textContent = "Mint Certificate";
    }
}

async function verifyCertificate(certId) {
    const trimmedId = certId.trim();
    
    if (!trimmedId) {
        statusMessage.style.color = 'orange';
        statusMessage.textContent = 'Please enter a Certificate ID to verify.';
        return;
    }
    
    statusMessage.textContent = `Verifying ID: ${trimmedId}...`;
    certIdInput.value = trimmedId;

    try {
        const url = `${WORKER_URL}/certificate/${trimmedId}`;
        const response = await fetch(url, { method: 'HEAD' });

        if (response.ok || response.status === 200) {
            statusMessage.style.color = 'green';
            statusMessage.innerHTML = `✅ <strong>Verified Authentic</strong><br>ID: ${trimmedId}`;
            output.textContent = "Certificate Verified via Scan";
        } else {
            statusMessage.style.color = 'red';
            statusMessage.textContent = '❌ Certificate Invalid or Not Found';
        }
    } catch (e) {
        statusMessage.textContent = `Scanned ID: ${trimmedId}. Verification check failed (Network error).`;
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
        console.log("QR Code detected:", verifyId);
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
