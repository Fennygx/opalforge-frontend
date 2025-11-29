// --- Configuration ---
const WORKER_URL = 'https://api.opalforge.tech'; // UPDATED: Points to your CNAME record
const APP_URL = 'https://opalforge.tech'; // Your frontend domain

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

// --- 1. AI & Model Logic ---

async function loadModel() {
    loader.style.display = 'block';
    output.textContent = 'Loading AI model...';
    try {
        const m = await tf.loadLayersModel('./model/model.json');
        model = m;
        loader.style.display = 'none';
        output.textContent = 'Ready. Upload an image.';
    } catch (err) {
        console.error('Model error:', err);
        loader.style.display = 'none';
        output.textContent = 'System Error: Model could not be loaded.';
    }
}

async function predictImage(imgElement) {
    return tf.tidy(() => {
        const imgTensor = tf.browser.fromPixels(imgElement);
        const resized = tf.image.resizeBilinear(imgTensor, [224, 224]);
        const normalized = resized.toFloat().div(255).expandDims(0);
        const logits = model.predict(normalized);
        const data = logits.dataSync();
        return Math.max(...data) * 100;
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

// --- 2. Certificate Logic (Minting & Verification) ---

/**
 * GENERATE (MINT): 
 * 1. Creates a random ID.
 * 2. Sends ID + Date + QR Data to Worker.
 * 3. Downloads PDF.
 */
async function mintCertificate() {
    if (currentConfidence < 85) {
        alert("Authentication score too low to mint certificate.");
        return;
    }

    // Generate a Random ID (In a real app, the Worker should do this, but this works for now)
    const newCertId = 'OF-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    
    // THE STRATEGY: This URL is what goes INSIDE the QR Code
    // When scanned, it leads back here with ?verify=ID
    const qrPayload = `${APP_URL}/?verify=${newCertId}`;

    statusMessage.textContent = 'Minting Certificate...';
    mintButton.disabled = true;
    mintButton.textContent = "Processing...";

    try {
        // We pass the ID and the QR URL to the worker as query params
        // Ensure your Worker is set up to read these!
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
            throw new Error('Worker returned error');
        }
    } catch (e) {
        console.error(e);
        statusMessage.textContent = 'Minting failed. Check connection.';
    } finally {
        mintButton.disabled = false;
        mintButton.textContent = "Mint Certificate";
    }
}

/**
 * VERIFY:
 * Checks if a Certificate ID exists (Simulated for now by trying to fetch it).
 */
async function verifyCertificate(certId) {
    if (!certId) return;
    
    statusMessage.textContent = `Verifying ID: ${certId}...`;
    certIdInput.value = certId; // Fill input for visual feedback

    // In a real database app, we would query an API.
    // Here, we simulate verification by attempting to fetch the cert.
    // If the Worker generates it without error, we assume it's valid for this prototype.
    try {
        const url = `${WORKER_URL}/certificate/${certId}`;
        const response = await fetch(url, { method: 'HEAD' }); // Just check headers

        if (response.ok || response.status === 200) {
            statusMessage.style.color = 'green';
            statusMessage.innerHTML = `✅ <strong>Verified Authentic</strong><br>ID: ${certId}`;
            output.textContent = "Certificate Verified via Scan";
            
            // Optional: Auto-download the proof again
            // downloadCertificate(certId); 
        } else {
            statusMessage.style.color = 'red';
            statusMessage.textContent = '❌ Certificate Invalid or Not Found';
        }
    } catch (e) {
        // Fallback for demo: just show it was scanned
        statusMessage.textContent = `Scanned ID: ${certId}. (Database check pending)`;
    }
}

// --- 3. Event Listeners ---

uploadButton.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    loader.style.display = 'block';
    output.textContent = 'Analyzing...';
    resultAction.style.display = 'none'; // Hide previous results

    const reader = new FileReader();
    reader.onload = async (ev) => {
        const img = showPreview(ev.target.result);
        img.onload = async () => {
            currentConfidence = await predictImage(img);
            loader.style.display = 'none';
            
            if (currentConfidence > 85) {
                output.innerHTML = `<span style="color:green">Authentic (${currentConfidence.toFixed(1)}%)</span>`;
                resultAction.style.display = 'block'; // Show Mint Button
            } else {
                output.innerHTML = `<span style="color:red">Potential Replica (${currentConfidence.toFixed(1)}%)</span>`;
                resultAction.style.display = 'none';
            }
        };
    };
    reader.readAsDataURL(file);
});

mintButton.addEventListener('click', mintCertificate);

verifyButton.addEventListener('click', () => {
    verifyCertificate(certIdInput.value.trim());
});

// --- 4. Initialization & URL Param Check (QR Logic) ---

window.addEventListener('load', async () => {
    await loadModel();

    // CHECK FOR QR CODE SCAN
    // If the user came here via opalforge.tech/?verify=123
    const urlParams = new URLSearchParams(window.location.search);
    const verifyId = urlParams.get('verify');

    if (verifyId) {
        console.log("QR Code detected:", verifyId);
        // Scroll to verification section
        document.getElementById('verifySection').scrollIntoView();
        // Trigger verification
        verifyCertificate(verifyId);
    }
});

// Mousemove effect
document.addEventListener('mousemove', e => {
    const x = Math.round((e.clientX / window.innerWidth) * 100);
    const y = Math.round((e.clientY / window.innerHeight) * 100);
    document.body.style.background = `linear-gradient(180deg,var(--snow) 60%, var(--navy) 40%), radial-gradient(circle at ${x}% ${y}%, rgba(184,134,11,0.06), transparent 15%)`;
});
