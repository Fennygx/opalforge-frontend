// --- Configuration ---
// Define the URL for your Cloudflare Worker API.
const WORKER_URL = 'https://opalforge-cert-gen.garcia-fenny.workers.dev';

// --- DOM Element References ---
const output = document.getElementById('output');
const loader = document.getElementById('loader');
const uploadButton = document.getElementById('upload');
const fileInput = document.getElementById('fileInput');
const imgPreview = document.getElementById('imgPreview');

const certIdInput = document.getElementById('certIdInput');
const generateButton = document.getElementById('generateButton');
const statusMessage = document.getElementById('statusMessage');

// Initial state
loader.style.display = 'none';
let model = null;

// --- AI Model Loading Functions ---

/**
 * Loads the TensorFlow.js model from the specified path.
 */
async function loadModel() {
    loader.style.display = 'block';
    output.textContent = 'Loading AI model...';
    try {
        // CRITICAL FIX: The path is now correctly set to 'model/model.json'
        const m = await tf.loadLayersModel('./model/model.json');
        model = m;
        loader.style.display = 'none';
        output.textContent = 'AI Model loaded. Upload an image for authentication.';
    } catch (err) {
        console.error('Model loading error:', err);
        loader.style.display = 'none';
        output.textContent = 'Error loading model. Ensure model/model.json and weights are hosted and accessible via HTTP(S).';
    }
}

/**
 * Runs the uploaded image through the loaded model for prediction.
 * @param {HTMLImageElement} imgElement - The image element to predict.
 * @returns {Promise<number>} - The confidence score (as a percentage).
 */
async function predictImage(imgElement) {
    // Wrap the prediction logic in tf.tidy to clean up Tensors immediately
    return tf.tidy(() => {
        const imgTensor = tf.browser.fromPixels(imgElement);
        const resized = tf.image.resizeBilinear(imgTensor, [224, 224]);
        const normalized = resized.toFloat().div(255).expandDims(0); // [1, 224, 224, 3]

        const logits = model.predict(normalized);
        const data = logits.dataSync(); // Use dataSync for synchronous read inside tidy
        const confidence = Math.max(...data) * 100;
        
        return confidence;
    });
}

/**
 * Displays the uploaded image in the preview box.
 * @param {string} dataUrl - Base64 encoded image data.
 */
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
}

// --- Certificate Verification/Download Functions ---

/**
 * Calls the Cloudflare Worker API to download the certificate PDF.
 */
async function downloadCertificate() {
    const certId = certIdInput.value.trim();
    if (!certId) {
        statusMessage.textContent = 'Please enter a Certificate ID.';
        return;
    }

    statusMessage.textContent = 'Searching for certificate...';
    generateButton.disabled = true;

    try {
        const url = `${WORKER_URL}/certificate/${certId}`;
        const response = await fetch(url, { method: 'GET' });

        if (response.ok) {
            // Success: Handle the file download
            const blob = await response.blob();
            const filename = `opalforge_certificate_${certId}.pdf`;
            
            // Create a temporary link element to trigger the download
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            statusMessage.textContent = `Success! Downloading certificate for ID: ${certId}.`;
        } else {
            // Error handling based on response status
            const errorText = await response.text();
            statusMessage.textContent = `Error: Certificate ID ${certId} not found or invalid. (${response.status})`;
            console.error('API Error:', errorText);
        }
    } catch (error) {
        statusMessage.textContent = 'Network error or Worker is unavailable.';
        console.error('Fetch error:', error);
    } finally {
        generateButton.disabled = false;
    }
}


// --- Event Listeners ---

// 1. Image Upload Trigger
uploadButton.addEventListener('click', () => fileInput.click());

// 2. Image File Selection and Prediction
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) { output.textContent = 'No file selected.'; return; }
    if (!model) { output.textContent = 'Model not loaded yet. Please wait...'; return; }

    loader.style.display = 'block';
    output.textContent = 'Processing image...';

    const reader = new FileReader();
    reader.onload = async (ev) => {
        const dataUrl = ev.target.result;
        showPreview(dataUrl);

        const img = new Image();
        img.src = dataUrl;
        img.onload = async () => {
            try {
                const conf = await predictImage(img);
                output.textContent = `Confidence: ${conf.toFixed(2)}% Replica`;
            } catch (err) {
                console.error('Prediction error:', err);
                output.textContent = 'Error processing image.';
            }
            loader.style.display = 'none';
        };
        img.onerror = () => { loader.style.display = 'none'; output.textContent = 'Error loading image.'; };
    };
    reader.onerror = () => { loader.style.display = 'none'; output.textContent = 'Error reading file.'; };
    reader.readAsDataURL(file);
});

// 3. Certificate Download Trigger
generateButton.addEventListener('click', downloadCertificate);


// 4. Initialization on Load
window.addEventListener('load', async () => {
    await loadModel();
});

// 5. Mousemove effect for background glow
document.addEventListener('mousemove', e => {
    const xRatio = e.clientX / window.innerWidth;
    const yRatio = e.clientY / window.innerHeight;
    const xPos = Math.round(xRatio * 100);
    const yPos = Math.round(yRatio * 100);
    document.body.style.background = `linear-gradient(180deg,var(--snow) 60%, var(--navy) 40%), radial-gradient(circle at ${xPos}% ${yPos}%, rgba(184,134,11,0.06), transparent 15%)`;
});
