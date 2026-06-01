const path = require('path');
const rcedit = require('rcedit');

module.exports = async function afterPack(context) {
    if (context.electronPlatformName !== 'win32') {
        return;
    }

    const packager = context.packager;
    const version = packager.appInfo.version;
    const executableName = packager.executableName || packager.appInfo.productFilename;
    const exePath = path.join(context.appOutDir, `${executableName}.exe`);
    const iconPath = path.join(packager.projectDir, 'assets', 'icon.ico');

    await rcedit(exePath, {
        icon: iconPath,
        'file-version': version,
        'product-version': version,
        'version-string': {
            CompanyName: 'EvoSurf',
            FileDescription: 'Official EvoSurf Viewer',
            InternalName: executableName,
            OriginalFilename: `${executableName}.exe`,
            ProductName: 'EvoSurf',
        },
    });
};
