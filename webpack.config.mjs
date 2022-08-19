import WebExtPlugin from 'web-ext-plugin';
import CopyPlugin from 'copy-webpack-plugin';
import webpack from 'webpack';

/**
 * Hack replacement of webpack's default baseURI runtimme implementation that
 * returns a string or undefined. And that doesn't work well when used with
 * `new URL(..., baseURI)` where the base URI is a secret plugin installation
 * path only known at runtime.
 */
class PatchedBaseUriRuntimeModule extends webpack.RuntimeModule {
  constructor() {
    super("base uri", webpack.RuntimeModule.STAGE_ATTACH);
  }

  generate() {
    return `${webpack.RuntimeGlobals.baseURI} = self.location;`;
  }
}

class PatchedBaseUriPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('RuntimePlugin', compilation => {
      const globalChunkLoading = compilation.outputOptions.chunkLoading;
      const isChunkLoadingDisabledForChunk = chunk => {
        const options = chunk.getEntryOptions();
        const chunkLoading =
          options && options.chunkLoading !== undefined
            ? options.chunkLoading
            : globalChunkLoading;
        return chunkLoading === false;
      };

      compilation.hooks.runtimeRequirementInTree
        .for(webpack.RuntimeGlobals.baseURI)
        .tap("RuntimePlugin", chunk => {
          if (isChunkLoadingDisabledForChunk(chunk)) {
            compilation.addRuntimeModule(chunk, new PatchedBaseUriRuntimeModule());
            return true;
          }
        });
    })
  }
}

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
    'popup': './src/popup/popup.js'
  },
  output: {
    path: new URL("./extension", import.meta.url).pathname,
    publicPath: '',
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
    new PatchedBaseUriPlugin(),
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