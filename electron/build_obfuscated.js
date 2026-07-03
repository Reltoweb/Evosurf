const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const filesToObfuscate = ['main.js', 'preload.js', 'secure_storage.js'];
const outputDir = path.join(__dirname, 'app');

// Ensure output directory exists and is empty-ish
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

// Copy other necessary files
const filesToCopy = ['package.json', 'icon.png', 'icon.ico', 'convert_icon.js']; // Include convert for reference or exclude? better exclude.
// Actually we need package.json in the app dir for it to run if we package the app dir, 
// OR we package the root and just use the obfuscated files.
// Simpler approach: Obfuscate in place or to a build folder and package that.

// Strategy:
// 1. Create 'build' folder.
// 2. Copy all files except source JS.
// 3. Obfuscate source JS into 'build'.
// 4. Update package.json in 'build' to not have devDependencies? Or just keep it.

console.log('Starting obfuscation...');

filesToObfuscate.forEach(file => {
    const sourceCode = fs.readFileSync(file, 'utf8');
    const obfuscationResult = JavaScriptObfuscator.obfuscate(sourceCode, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 1,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.2, // Low to avoid too much bloat
        debugProtection: true,
        disableConsoleOutput: true,
        identifierNamesGenerator: 'hexadecimal',
        log: false,
        numbersToExpressions: true,
        renameGlobals: false,
        selfDefending: true,
        simplify: true,
        splitStrings: true,
        stringArray: true,
        stringArrayEncoding: ['rc4'], // Stronger encoding
        target: 'node',
        ignoreRequireImports: true
    });

    const outputPath = path.join(outputDir, file);
    fs.writeFileSync(outputPath, obfuscationResult.getObfuscatedCode());
    console.log(`Obfuscated: ${file} -> ${outputPath}`);
});

// Copy package.json but remove local dev deps references if needed, 
// or just copy strictly necessary files.
const pkg = require('./package.json');
// Remove build config from the app package.json to avoid electron-builder error
delete pkg.build;
delete pkg.scripts;
// Ensure version is synced from root package.json
// We might want to adjust main point if we move things, but here we keep structure.
fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(pkg, null, 2));
console.log(`Version ${pkg.version} synced to app/package.json`);

// Copy Icon
fs.copyFileSync('icon.ico', path.join(outputDir, 'icon.ico'));
fs.copyFileSync('icon.png', path.join(outputDir, 'icon.png'));
fs.copyFileSync('splash.html', path.join(outputDir, 'splash.html'));

// Copy dependencies (node_modules) - This is tricky. 
// Electron packager usually handles this. 
// BETTER STRATEGY: 
// Just obfuscate the files in a way that Packager picks them up, or point Packager to 'app' folder which we populate with everything including node_modules install.
// OR: We use a hook in electron-packager. 
// SIMPLEST: We'll instruct the user (or script) to install prod deps in 'app' folder.
// But for now, let's just copy package.json and let the user know, or use the root and just swap files? No that's destructive.

// Let's rely on electron-packager to grab the 'app' folder if we run it FROM there, or we tell packager to package 'app'.
console.log('Obfuscation complete. Ready to package from ./app directory.');
