const fs = require('fs');
const path = require('path');

/**
 * 过滤Electron构建后的语言包，只保留en-US.pak和zh-CN.pak
 */
function filterLocales() {
    const distPath = path.join(__dirname, '..', 'dist');

    // 查找所有可能的Electron资源目录
    const possiblePaths = [
        path.join(distPath, 'win-unpacked', 'resources'),
        path.join(distPath, 'win-unpacked', 'locales'),
        path.join(distPath, 'OpenClaw安装管理器-win32-x64', 'locales'),
        path.join(distPath, 'PortableApps', 'OpenClaw安装管理器', 'locales')
    ];

    let localesDir = null;

    // 找到包含语言包的目录
    for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
            const files = fs.readdirSync(testPath);
            const pakFiles = files.filter(file => file.endsWith('.pak'));

            if (pakFiles.length > 0) {
                localesDir = testPath;
                break;
            }
        }
    }

    if (!localesDir) {
        console.log('未找到包含语言包的目录');
        return;
    }

    console.log(`找到语言包目录: ${localesDir}`);

    // 获取所有.pak文件
    const allFiles = fs.readdirSync(localesDir);
    const pakFiles = allFiles.filter(file => file.endsWith('.pak'));

    console.log(`发现 ${pakFiles.length} 个语言包:`, pakFiles);

    // 定义要保留的语言包
    const keepFiles = ['en-US.pak', 'zh-CN.pak'];

    // 删除不需要的语言包
    for (const file of pakFiles) {
        if (!keepFiles.includes(file)) {
            const filePath = path.join(localesDir, file);
            try {
                fs.unlinkSync(filePath);
                console.log(`已删除语言包: ${file}`);
            } catch (error) {
                console.error(`删除语言包失败 ${file}:`, error.message);
            }
        }
    }

    console.log(`保留语言包: ${keepFiles.join(', ')}`);
    console.log('语言包过滤完成');
}

filterLocales();