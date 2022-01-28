document.querySelector('#translate-btn').addEventListener('click', e => {
	browser.tabs.query({active: true, currentWindow: true}).then(tabs => {
		browser.runtime.sendMessage({command: 'translationRequested', tabId: tabs[0].id});
	});
})