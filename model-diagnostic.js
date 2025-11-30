/**
 * OpalForge Model Diagnostic Script
 * 
 * Add this to your index.html temporarily to diagnose the confidence score issue.
 * Open browser console and call: diagnoseModel()
 * 
 * This will help identify:
 * 1. Model input/output shapes
 * 2. Label order (authentic vs replica)
 * 3. Whether outputs are probabilities or logits
 */

async function diagnoseModel() {
    if (!model) {
        console.error('Model not loaded yet!');
        return;
    }

    console.log('=== OpalForge Model Diagnostics ===\n');
    
    // 1. Model Architecture Info
    console.log('1. MODEL ARCHITECTURE:');
    console.log('   Input shape:', model.inputs[0].shape);
    console.log('   Output shape:', model.outputs[0].shape);
    console.log('   Total layers:', model.layers.length);
    
    // Get last layer info
    const lastLayer = model.layers[model.layers.length - 1];
    console.log('   Last layer type:', lastLayer.getClassName());
    console.log('   Last layer config:', lastLayer.getConfig());
    
    // 2. Test with synthetic data
    console.log('\n2. SYNTHETIC DATA TEST:');
    
    // Create a completely black image (should be clearly "replica" or unusual)
    const blackImage = tf.zeros([1, 224, 224, 3]);
    const blackPred = model.predict(blackImage);
    console.log('   Black image prediction:', blackPred.dataSync());
    blackImage.dispose();
    blackPred.dispose();
    
    // Create a completely white image
    const whiteImage = tf.ones([1, 224, 224, 3]);
    const whitePred = model.predict(whiteImage);
    console.log('   White image prediction:', whitePred.dataSync());
    whiteImage.dispose();
    whitePred.dispose();
    
    // Create random noise
    const noiseImage = tf.randomUniform([1, 224, 224, 3]);
    const noisePred = model.predict(noiseImage);
    console.log('   Random noise prediction:', noisePred.dataSync());
    noiseImage.dispose();
    noisePred.dispose();
    
    // 3. Check if outputs sum to 1 (probabilities) or not (logits)
    console.log('\n3. OUTPUT ANALYSIS:');
    const testPred = model.predict(tf.randomUniform([1, 224, 224, 3]));
    const testData = testPred.dataSync();
    const sum = Array.from(testData).reduce((a, b) => a + b, 0);
    console.log('   Output values:', testData);
    console.log('   Sum of outputs:', sum);
    
    if (Math.abs(sum - 1.0) < 0.01) {
        console.log('   ✓ Outputs appear to be PROBABILITIES (softmax)');
    } else if (testData.length === 1) {
        console.log('   ✓ Single output - likely SIGMOID activation');
        console.log('     Value interpretation: closer to 1 = one class, closer to 0 = other class');
    } else {
        console.log('   ⚠ Outputs may be LOGITS - softmax normalization needed');
    }
    testPred.dispose();
    
    // 4. Recommendations
    console.log('\n4. RECOMMENDATIONS:');
    console.log('   Check your model training code for:');
    console.log('   - Label order in training data (was "authentic" or "replica" first?)');
    console.log('   - Final activation function (softmax, sigmoid, or none?)');
    console.log('   - Whether you normalized outputs during training');
    
    console.log('\n5. QUICK FIX OPTIONS:');
    console.log('   If scores are inverted, try changing line 68-69 in app.js:');
    console.log('   FROM: const authenticIndex = 0;');
    console.log('   TO:   const authenticIndex = 1;');
    
    console.log('\n=== End Diagnostics ===');
}

// Also add a function to test with actual images
async function testImageConfidence(imageUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
            try {
                const confidence = await predictImage(img);
                console.log(`Image: ${imageUrl}`);
                console.log(`Confidence: ${confidence.toFixed(2)}%`);
                resolve(confidence);
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = reject;
        img.src = imageUrl;
    });
}

// Make functions available globally
window.diagnoseModel = diagnoseModel;
window.testImageConfidence = testImageConfidence;

console.log('Diagnostic tools loaded. Run diagnoseModel() in console to analyze your model.');
