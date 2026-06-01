const fs = require('fs');
const pngToIco = require('png-to-ico').default;
const { Jimp } = require('jimp');

async function convert() {
    try {
        console.log('Reading icon.png...');
        // Read original image with alpha channel preserved
        const originalImage = await Jimp.read('icon.png');
        
        // Ensure alpha channel is preserved
        if (originalImage.hasAlpha()) {
            console.log('Image has alpha channel - transparency will be preserved');
        } else {
            console.log('Warning: Image does not have alpha channel');
        }

        // Define target sizes
        const sizes = [256, 128, 64, 48, 32, 16];
        const buffers = [];

        console.log('Generating sizes...');
        for (const size of sizes) {
            // Clone the image so resizing doesn't affect the next iteration
            const image = originalImage.clone();
            // Jimp 1.x expects an options object: { w, h } (optionally { w, h, mode })
            image.resize({ w: size, h: size });
            // Ensure PNG format with alpha channel
            const buffer = await image.getBuffer('image/png');
            buffers.push(buffer);
        }

        console.log('Converting to multi-size ico with transparency...');
        // pngToIco accepts an array of buffers and should preserve transparency
        const icoBuffer = await pngToIco(buffers);

        fs.writeFileSync('icon.ico', icoBuffer);
        console.log('Created multi-size icon.ico with transparency preserved');
        console.log('Note: If Windows still shows squares, try:');
        console.log('  1. Delete electron/dist/ folder');
        console.log('  2. Clear Windows icon cache (restart Explorer or move exe to new location)');
        console.log('  3. Rebuild with: npm run build');
    } catch (error) {
        console.log('Error occurred:');
        console.error(error.message || error);
        if (error.stack) {
            console.error(error.stack);
        }
    }
}

convert();
