import WebExtPlugin from 'web-ext-plugin';
import CopyPlugin from 'copy-webpack-plugin';

const module = {
  rules: [
    {
      test: /\.(html|css|wasm)$/i,
      type: 'asset/resource'
    }
  ]
};

export default {
  module,
  mode: 'development',
  entry: {
    'content-script': './src/content/content-script.js',
    'background-script': './src/background/background-script.js',
    'benchmark': './src/benchmark/benchmark.js',
    'options': './src/options/options.js',
    'popup': './src/popup/popup.js',
  },
  output: {
    path: new URL("./extension", import.meta.url).pathname,
    chunkFormat: 'array-push',
    assetModuleFilename: '[name][ext]',
    globalObject: 'self',
  },
  target: [
    "es6"
  ],
  optimization: {
    minimize: false
  },
  devtool: "source-map",
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: 'assets/icons/*.png'
        },
        {
          from: 'src/benchmark/benchmark.html'
        },
        {
          from: 'src/options/options.html'
        },
        {
          from: 'src/popup/popup.html'
        },
        {
          from: 'node_modules/@browsermt/bergamot-translator/worker/bergamot-translator-worker.js'
        },
        {
          from: 'node_modules/@browsermt/bergamot-translator/worker/bergamot-translator-worker.wasm'
        },
        {
          from: 'src/manifest.json',
          transform(buffer) {
            const data = JSON.parse(buffer.toString());
            return JSON.stringify(data, null, 2);
          }
        }
      ]
    }),
    new WebExtPlugin({
      sourceDir: '../../extension',
      firefox: 'nightly',
    })
  ],
  experiments: {
    css: true
  }
};