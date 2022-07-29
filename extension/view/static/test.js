/**
 * Queue class that supports an overly complicated way of waiting for
 * certain conditions in the queue. Think of it as something someone
 * familiar with multithreading producer/consumer queues would built
 * when given async/await.
 */
class Queue extends Array {
	#pendingConditions = [];

	#pendingMutations = [];

	push(...args) {
		return super.push(...args);
	}

	pop() {
		return this.#checkAfterwards(() => super.pop());
	}

	shift() {
		return this.#checkAfterwards(() => super.shift());
	}

	reset() {
		return this.#checkAfterwards(() => this.splice(0, this.length));
	}

	#checkAfterwards(inner) {
		const retval = inner();
		
		this.#pendingConditions = this.#pendingConditions.filter(({condition, accept}) => {
			if (!condition()) return true;
			else accept();
		})
		
		for (let i = 0; i < this.#pendingMutations.length; ++i) {
			if (!this.#pendingMutations[i].condition())
				continue;

			const {accept} = this.#pendingMutations[i];
			this.#pendingMutations.splice(i, 1);
				
			// If accept() returns true, it means no mutation and we
			// can check the other conditions as well?
			accept(); // <- this may recursively call `#checkAfterwards()`!
			break;
		}

		return retval;
	}

	until(condition) {
		return this.#checkAfterwards(() => new Promise(accept => {
			this.#pendingConditions.push({condition, accept});
		}));
	}

	untilEmpty() {
		return this.until(() => this.length === 0);
	}

	shiftAsync() {
		return this.#checkAfterwards(() => new Promise(accept => {
			this.#pendingMutations.push({
				condition: () => this.length > 0,
				accept: () => accept(this.shift())
			})
		}));
	}
}

function msleep(duration) {
	return new Promise((accept) => {
		setTimeout(accept, duration);
	});
}

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
	const queue = new Queue();

	// Fake observer to call render every time the queue changes hehehe
	queue.until(() => {
		requestIdleCallback(render);
		return false;
	});

	const ipt = new InPageTranslation({
		translate(text, user) {
			queue.push({text, user});
			if (queue.length > 50) throw new Error('Runaway!');
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
	});

	section.querySelector('#translate-tail').addEventListener('click', e => {
		const request = queue.pop();
		ipt.enqueueTranslationResponse(translate(request.text), request.user);
	});

	section.querySelector('#toggle').addEventListener('click', e => {
		if (ipt.started) {
			ipt.stop();
			console.log(ipt.processedNodes);
			queue.reset();
		}
		
		ipt.start('en');

		render();
	});

	section.querySelector('#restore').addEventListener('click', e => {
		ipt.restore();
		queue.reset(); // because restore() involves stop()
	})

	section.querySelector('#run').addEventListener('click', async (e) => {
		class StopCondition {
			constructor(accept) {
				this.name = 'StopError';
				this.accept = accept;
			}
		}

		var stop;

		let condition = new Promise((acceptStop) => {
			stop = () => new Promise((acceptStopped) => {
				acceptStop(new StopCondition(acceptStopped));
			});
		});

		const worker = async () => {
			while (true) {
				const request = await Promise.race([condition, queue.shiftAsync()]);
				
				if (request instanceof StopCondition) {
					request.accept();
					break;
				}
				
				ipt.enqueueTranslationResponse(translate(request.text), request.user);
			}
			console.log('stop condition met');
		};

		e.target.disabled = true;

		worker(); // Start translating async

		ipt.start('en');

		await queue.untilEmpty();

		for (let i = 5; i > 0; --i) {
			addParagraph(document.querySelector('#dynamic'));
			increment(document.querySelector('#counter'));
			await msleep(500);
		}

		// Wait till mutation is picked up
		await queue.until(() => queue.length > 0);

		// Then wait till all mutations are processed again
		await queue.until(() => queue.length === 0);

		// Problem: queue empty does not mean that the translations have been
		// processed by InPageTranslation!

		// Restore page
		await msleep(1500);
		ipt.restore();

		// Stop worker (and wait till it has confirmed it stopped)
		await stop();

		e.target.disabled = false;
	})

	render();
})