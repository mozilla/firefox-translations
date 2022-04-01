/* eslint-disable no-unused-vars */

let engineRegistryRootURL = "https://github.com/mozilla/bergamot-translator/releases/download/v0.4.3/";
const engineRegistryRootURLTest = "https://example.com/browser/browser/extensions/translations/test/browser/";

let engineRegistry;

function getBergamotTranslatorWasmEngineRegistry(platformInfo) {
    return (platformInfo.arch === "x86-32") || (platformInfo.arch === "x86-64") ? engineRegistryShared.X86 : engineRegistryShared.NonX86;
}

const engineRegistryShared = {
    X86: {
        bergamotTranslatorWasm: {
            fileName: "bergamot-translator-worker-with-wormhole.wasm",
            fileSize: 6935339,
            sha256: "7e7f4d0b78342d7921a1b196d42ba1ecf5a172f8fe7a2b47143b4f16c9a8c8b5"
        }
    },
    NonX86: {
        bergamotTranslatorWasm: {
            fileName: "bergamot-translator-worker-without-wormhole.wasm",
            fileSize: 6937069,
            sha256: "111af29d090acfaccde31883e04dbde8adae737ee33062cf3572ff3918a592f7"
        }
    }
};
