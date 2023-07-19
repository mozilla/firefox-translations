import WebExtPlugin from 'web-ext-plugin';
import CopyPlugin from 'copy-webpack-plugin';
import webpack from 'webpack';

/**
 * Hack replacement of webpack's default baseURI runtime implementation that
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

function extend(dst, src) {
  if (Array.isArray(src)) {
    if (dst === undefined)
      dst = [];
    dst.splice(dst.length, 0, ...src);
  } else {
    dst = Object.assign(dst || {}, src);
  }
  return dst;
}

const module = {
  rules: [
    {
      test: /\.(html|css|wasm)$/i,
      type: 'asset/resource'
    }
  ]
};

const distPath = new URL("./extension", import.meta.url).pathname;

// Set to `false` if you want to use a consistent profile
const firefoxOptions = true ? {} : {
  firefoxProfile: 'translatelocally-web-ext',
  keepProfileChanges: true
};

const DEFAULT_TARGET = 'firefox-desktop';

export default (env) => ({
  module,
  mode: 'development',
  entry: {
    'content-script': './src/content/content-script.js',
    'background-script': './src/background/background-script.js',
    'benchmark': './src/benchmark/benchmark.js',
    'options': './src/options/options.js',
    'popup': './src/popup/popup.js',
    'offscreen': './src/background/offscreen.js'
  },
  output: {
    path: distPath,
    publicPath: '',
    chunkFormat: 'array-push',
    assetModuleFilename: '[name][ext]',
    globalObject: 'self',
  },
  target: [
    "es2020"
  ],
  optimization: {
    minimize: false // true works, but let people see the source!
  },
  devtool: "source-map",
  plugins: [
    new PatchedBaseUriPlugin(),
    new CopyPlugin({
      patterns: [
        {
          from: 'assets/fonts/*.woff2'
        },
        {
          from: 'assets/icons/*'
        },
        {
          from: 'src/benchmark/benchmark.html'
        },
        {
          from: 'src/benchmark/benchmark.css'
        },
        {
          from: 'src/options/options.html'
        },
        {
          from: 'src/popup/popup.html'
        },
        {
          from: 'src/background/offscreen.html'
        },
        {
          from: 'src/content/OutboundTranslation.css'
        },
        {
          from: 'src/content/SelectionTranslation.css'
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
            const target = env.target || DEFAULT_TARGET;
            const data = JSON.parse(buffer.toString());

            // Search for `xxx<chromium>` and `yyy<firefox-desktop>` keys
            // and use them (without the <> part) if they match the target.
            Object.keys(data).forEach(key => {
              const match = key.match(/^(.+?)\<([a-z0-9_-]+)\>$/)
              if (match) {
                if (match[2] === target)
                  data[match[1]] = extend(data[match[1]], data[key]);
                delete data[key];
              }
            }); 
            
            return JSON.stringify(data, null, 2);
          }
        }
      ]
    }),
    new webpack.DefinePlugin({
      'typeof self': JSON.stringify('object')
    }),
    new WebExtPlugin({
      target: env.target || DEFAULT_TARGET,
      ignoreKnownChromeLintFailures: true,
      sourceDir: distPath,
      firefox: 'nightly',
      ...firefoxOptions
    })
  ],
  experiments: {
    css: true
  }
});