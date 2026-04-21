# 语言包优化说明

## 目的
为减少最终安装包大小，仅保留必要的语言包(en-US.pak和zh-CN.pak)，移除其他所有语言包。

## 实现方式
1. 在electron-builder.yml中使用`electronLanguages`选项指定需要保留的语言:
   ```yaml
   electronLanguages:
     - en-US
     - zh-CN
   ```

2. 这样在构建过程中Electron Builder只会打包指定的语言包，从而减小最终安装包的体积。

## 效果
- 减少约几十MB的安装包大小
- 只保留英文和简体中文支持
- 移除了其他不必要的语言包

## 构建后验证
构建完成后可在以下路径检查语言包:
- `dist/win-unpacked/resources/locales/` (对于dir目标)
- 或相应的安装包内部

只有en-US.pak和zh-CN.pak会存在，其他语言包会被自动排除。