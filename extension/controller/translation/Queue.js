class Queue {
    constructor() {
        this.elements = [];
    }

    enqueue(e) {
        this.elements.push(e);
        console.log("enqueued", e, this.length());
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