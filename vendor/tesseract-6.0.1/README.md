# Tesseract.js 6.0.1

本地 OCR，用于「从 C2C 订单截图导入」。按需加载，不在页面启动时下载。

| 文件 | 来源 | 许可 |
|---|---|---|
| `tesseract.min.js`、`worker.min.js` | npm `tesseract.js@6.0.1` 的 `dist/` | Apache-2.0 |
| `tesseract-core-simd-lstm.wasm.js` | npm `tesseract.js-core@6.1.2` | Apache-2.0 |
| `chi_sim.traineddata.gz` | [tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) 的 `chi_sim.traineddata`，gzip 压缩 | Apache-2.0 |

只带了 SIMD + LSTM 一个内核。不支持 WebAssembly SIMD 的旧浏览器会加载失败，界面会提示改用粘贴文字。

语言数据选 `tessdata_fast`：对手机截图里的印刷体足够准，体积是 `tessdata_best` 的十分之一。
不要换成 npm `@tesseract.js-data/chi_sim` 的 `4.0.0` 版 —— 它会在汉字之间插空格、漏小数点。
