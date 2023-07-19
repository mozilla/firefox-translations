import WASMTranslationHelper from "./WASMTranslationHelper.js";

let helper = null;

function cloneError(error) {
	return {
		name: error.name,
		message: error.message,
		stack: error.stack
	};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.target !== 'offscreen')
		return false;

	const waitAndRespond = (promise) => Promise.resolve(promise).then(
		result => {
			console.log("Result", result);
			sendResponse({result})
		},
		error => {
			console.log('Error', error);
			sendResponse({error: cloneError(error)});
		}
	);

	switch (message.command) {
		case 'Initialize':
			waitAndRespond((async () => {
				console.log('Initialize');

				if (helper)
					await helper.delete();

				helper = new WASMTranslationHelper(...message.data.args);
				console.log('Initialized');
				return undefined;
			})());
			break;

		case 'Get':
			console.log('Get', message.data.property);
			waitAndRespond(Reflect.get(helper, message.data.property, helper));
			break;

		case 'Call':
			console.log('Call', message.data.name);
			waitAndRespond(Reflect.apply(helper[message.data.name], helper, message.data.args));
			break;
	}
	
	// for async sendResponse according to https://developer.chrome.com/docs/extensions/mv2/messaging/
	return true;
});
