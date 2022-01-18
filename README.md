# readable-stream-fanout

A `ReadableStream.tee()` supporting an arbitrary number of branches.

## Example

```js
import ReadableStreamFanout from "./mod.ts"

const fanout = new ReadableStreamFanout(readable)
fanout.start()

fanout.add().pipeTo(writable)

let branch = fanout.add()
for await (const chunk of branch) { /* ... */ }
fanout.close(branch)
```

## References

* [ReadableStream.tee()](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/tee)
* [Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)

## License

This project is licensed under the terms of the [MIT license](LICENSE.txt).
