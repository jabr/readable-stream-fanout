// @todo: convert this to actual tests...

import { delay } from "https://deno.land/std/async/mod.ts"
import ReadableStreamFanout from "./mod.ts"

async function log(
    name: string,
    readable: ReadableStream,
    count: number = Infinity
) {
    const reader = readable.getReader()
    while (true) {
        if (count-- <= 0) reader.cancel(`${name} lost interest`)
        let { value, done } = await reader.read()
        if (done) break
        console.log(`${name} read`, value)
    }
    reader.releaseLock()
    console.log(`${name} reading done`)
}

console.log('main')
const ts = new TransformStream
const wr = ts.writable.getWriter()
const fo = new ReadableStreamFanout(ts.readable)
fo.start()

let r1 = fo.add()
log('r1', r1)
let r2 = fo.add()
log('r2', r2)
let r3 = fo.add()
log('r3', r3, 2)
console.log('fanout branches', fo.size)

await wr.write({a: 1})

fo.close(r1)
console.log('fanout branches', fo.size)

await wr.write({a: 2})
console.log('fanout branches', fo.size)

await wr.write({a: 3})
console.log('fanout branches', fo.size)

await delay(2_000)
await wr.write({a: 4})
await delay(2_000)
