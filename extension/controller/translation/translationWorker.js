console.log("Initializing the main worker");
onmessage = async function(message) {

    switch (message.data[0]) {
        // command to submit a request to the wasm module to translate text
        case "translate":
            console.log("posting message halibaba");
            message.data[1].translatedParagraph = "HALIBABA";
            postMessage(["translated", message.data[1]]);
            break;
        default:
            // ignore
      }
}