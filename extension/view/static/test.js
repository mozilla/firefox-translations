let counter = 0;

function increment(element) {
	element.textContent = `This is the ${++counter}th iteration of this sentence.`;
}

function addParagraph(element) {
	const paragraph = document.createElement('p');
	paragraph.innerHTML = `Oh look at me, I'm <em>the ${++counter}th paragraph</em> today.`;
	element.appendChild(paragraph);
}

function *WrapIterator(walker) {
	for (let node; node = walker.nextNode();) {
		yield node;
	}
}

function translate(html) {
	const div = document.createElement('div');
	div.innerHTML = html;

	const walker = document.createNodeIterator(div, NodeFilter.SHOW_TEXT);

	Array.from(WrapIterator(walker)).forEach(text => {
		const reversed = document.createTextNode(text.data.split('').reverse().join(''));
		text.parentNode.replaceChild(reversed, text);
	});

	return div.innerHTML;
}

document.querySelectorAll('[data-callback]').forEach(element => {
	element.addEventListener('click', e => {
		const target = document.querySelector(element.dataset.selector);
		window[element.dataset.callback](target);
	})
});

document.querySelectorAll('#controls').forEach(section => {
	let queue = [];

	const ipt = new InPageTranslation({
		translate(text, user) {
			queue.push({text, user});
			if (queue.length > 50) throw new Error('Runaway!');
			requestIdleCallback(render);
		}
	});

	window.$ipt = ipt; // for debugging

	ipt.addElement(document.querySelector('head > title'));
	ipt.addElement(document.body);

	function render() {
		section.querySelector('#status').textContent = `There are ${queue.length} translation requests`;
		section.querySelector('#toggle').textContent = ipt.started ? 'Restart' : 'Start';
		section.querySelector('#translate-head').disabled = queue.length === 0;
		section.querySelector('#translate-tail').disabled = queue.length === 0;

		const ol = document.querySelector('#queue');
		ol.innerHTML = '';

		queue.forEach(request => {
			const li = ol.appendChild(document.createElement('li'));
			const pre = li.appendChild(document.createElement('pre'));
			const json = JSON.stringify(request, null, 2);
			pre.appendChild(document.createTextNode(json));
		});
	};

	section.querySelector('#translate-head').addEventListener('click', e => {
		const request = queue.shift();
		ipt.enqueueTranslationResponse(translate(request.text), request.user);
		render();
	});

	section.querySelector('#translate-tail').addEventListener('click', e => {
		const request = queue.pop();
		ipt.enqueueTranslationResponse(translate(request.text), request.user);
		render();
	});

	section.querySelector('#toggle').addEventListener('click', e => {
		if (ipt.started) {
			ipt.stop();
			console.log(ipt.processedNodes);
			queue = [];
		}
		
		ipt.start('en');

		render();
	});

	render();
})