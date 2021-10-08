console.log("Initializing the main worker");
onmessage = function(message) {
    const command = message.data[0];
    const sender = message.data[1];
    const payload = message.data[2];
    switch (command) {
        // command to submit a request to the wasm module to translate text
        case "translate":
            console.log("posting message halibaba");
            payload.translation = "HALIBABA";
            postMessage([
                "translation",
                sender,
                payload
            ]);
            break;
        default:
            // ignore
      }
}