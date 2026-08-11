const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const filesToObfuscate = ['main.js', 'preload.js', 'secure_storage.js'];
const outputDir = path.join(__dirname, 'app');

// Always rebuild the generated application directory from the current sources.
// Keeping an old directory here previously caused electron-builder to package an
// obsolete version and omit viewer-core.
if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
}
fs.mkdirSync(outputDir, { recursive: true });

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

const pkg = require('./package.json');
delete pkg.build;
delete pkg.scripts;
delete pkg.devDependencies;
fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(pkg, null, 2));
console.log(`Version ${pkg.version} synced to app/package.json`);

for (const file of ['icon.ico', 'icon.png', 'splash.html', 'default-client-url.js', 'config.json']) {
    if (fs.existsSync(file)) {
        fs.copyFileSync(file, path.join(outputDir, file));
    }
}
fs.cpSync(path.join(__dirname, 'viewer-core'), path.join(outputDir, 'viewer-core'), { recursive: true });

console.log('Obfuscation complete. Ready to package from ./app directory.');
