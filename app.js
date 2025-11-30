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
let modelMetadata = null;
let currentConfidence = 0;
let currentImageData = null;

// --- Model Loading with Metadata ---

async function loadModelMetadata() {
    try {
        const response = await fetch('./model/metadata.json');
        if (response.ok) {
            modelMetadata = await response.json();
            console.log('Model metadata loaded:', modelMetadata);
            console.log('Labels:', modelMetadata.labels);
            return modelMetadata;
        }
    } catch (err) {
        console.warn('Could not load metadata.json, using defaults:', err);
    }
    
    // Default metadata if file not found
    modelMetadata = {
        labels: ["Verified Authentic", "Verified Replica / Counterfeit"],
        imageSize: 224,
        modelName: "OpalForge"
    };
    return modelMetadata;
}

async function loadModel() {
    loader.style.display = 'block';
    output.textContent = 'Loading AI model...';
    
    try {
        // Load metadata first
        await loadModelMetadata();
        
        // Clear any cached corrupted model
        await tf.disposeVariables();
        
        // Load fresh model instance
        const m = await tf.loadLayersModel('./model/model.json');
        model = m;
        
        // Validate model loaded correctly
        if (!model || !model.predict) {
            throw new Error('Model structure invalid');
        }
        
        // Log model info for debugging
        console.log('Model loaded successfully');
        console.log('Input shape:', model.inputs[0].shape);
        console.log('Output shape:', model.outputs[0].shape);
        console.log('Model name:', modelMetadata.modelName);
        
        // Validate weights aren't corrupted - quick sanity check
        const testPred = model.predict(tf.zeros([1, 224, 224, 3]));
        const testData = testPred.dataSync();
        console.log('Sanity check (black image):', testData);
        testPred.dispose();
        
        // Check if predictions are suspiciously uniform
        if (Math.abs(testData[0] - testData[1]) < 0.001) {
            console.warn('⚠ WARNING: Model outputs are nearly identical - weights may be corrupted!');
        }
        
        loader.style.display = 'none';
        output.textContent = 'Ready. Upload an image.';
        
    } catch (err) {
        console.error('Model loading error:', err);
        loader.style.display = 'none';
        output.textContent = 'System Error: Model could not be loaded. Please refresh the page.';
    }
}

// --- Prediction Logic ---

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
            
            // Resize to model's expected input size (from metadata or default 224)
            const imageSize = modelMetadata?.imageSize || 224;
            const resized = tf.image.resizeBilinear(imgTensor, [imageSize, imageSize]);
            
            // Normalize to [0, 1] range
            const normalized = resized.toFloat().div(255.0);
            
            // Add batch dimension
            const batched = normalized.expandDims(0);
            
            // Run prediction
            const prediction = model.predict(batched);
            const predData = prediction.dataSync();
            
            console.log('Raw prediction output:', predData);
            
            // FIXED: Labels are inverted in the model output
            // Despite metadata saying Index 0 = Authentic, the model outputs:
            // Index 0 = Replica, Index 1 = Authentic
            
            let authenticProb, replicaProb;
            
            if (predData.length === 2) {
                // Model uses softmax with 2 outputs - SWAPPED
                authenticProb = predData[1];  // Index 1 is actually Authentic
                replicaProb = predData[0];    // Index 0 is actually Replica
                
                // Verify they sum to ~1 (softmax output)
                const sum = authenticProb + replicaProb;
                console.log(`Authentic: ${authenticProb.toFixed(4)}, Replica: ${replicaProb.toFixed(4)}, Sum: ${sum.toFixed(4)}`);
                
                if (Math.abs(sum - 1.0) > 0.1) {
                    console.warn('Outputs do not sum to 1 - may need normalization');
                }
            } else if (predData.length === 1) {
                // Single output (sigmoid) - value is P(class 0)
                authenticProb = predData[0];
                replicaProb = 1 - authenticProb;
            } else {
                throw new Error(`Unexpected output shape: ${predData.length}`);
            }
            
            // Convert to percentage (0-100)
            const confidence = authenticProb * 100;
            
            // Sanity check - clamp to valid range
            const clampedConfidence = Math.max(0, Math.min(100, confidence));
            
            console.log(`Final confidence: ${clampedConfidence.toFixed(1)}% authentic`);
            
            return clampedConfidence;
            
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
