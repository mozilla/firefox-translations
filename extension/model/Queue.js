// eslint-disable-next-line no-unused-vars
class Queue {
    constructor() {
        this.elements = [];
    }

    enqueue(e) {
        this.elements.push(e);
    }

    // remove an element from the front of the queue
    dequeue() {
        return this.elements.shift();
    }

    isEmpty() {
        return this.elements.length === 0;
    }

    peek () {
        if (!this.isEmpty()){
            return this.elements[0]
        }
        return null;
    }

    length () {
        return this.elements.length;
    }
}