import { deferred, delay } from "https://deno.land/std/async/mod.ts"

type RSDC = ReadableStreamDefaultController
type Controllable = ReadableStream & { controller: RSDC }

export class FanoutReadableStream {
    private source: ReadableStream
    private branches: Set<ReadableStream> = new Set
    private backpressure = deferred<void>()

    constructor(source: ReadableStream) {
        this.source = source
    }

    add(): ReadableStream {
        const fanout = this
        const underlyingSource = {
            cancelled: false,
            controller: {} as RSDC,
            start(controller: RSDC): any {
                this.controller = controller
            },
            async pull() {
                fanout.backpressure.resolve()
                console.log('pull attempt on underlying source')
            },
            async cancel(reason?: any) {
                this.cancelled = true
                console.log('source cancel', reason)
            }
        }

        const stream = new ReadableStream(underlyingSource)

        let controllable = stream as Controllable
        controllable.controller = underlyingSource.controller

        this.branches.add(stream)
        return stream
    }

    close(branch: ReadableStream) {
        console.log('manual branch close')
        let controllable = branch as Controllable
        controllable.controller.close()
        this.branches.delete(branch)
    }

    async start() {
        for await (const chunk of this.source) {
            await this.backpressure
            let applyBackpressure = true

            for (const branch of this.branches) {
                // @todo: how to check that it's closed?
                if (!branch.locked) {
                    console.log('skipping enqueue on unlocked branch')
                    continue
                }
                let controller = (branch as Controllable).controller
                controller.enqueue(chunk)
                let desiredSize = controller.desiredSize
                if ((desiredSize || 0) > 0) {
                    applyBackpressure = false
                    console.log('branch wants more', desiredSize)
                }
            }

            if (applyBackpressure) this.backpressure = deferred<void>()
        }
    }

    dump() {
        console.log('fanout branches')
        for (const branch of this.branches) {
            console.log('branch', branch as Controllable)
        }
    }
}

if (import.meta.main) {
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
    const fo = new FanoutReadableStream(ts.readable)
    fo.start()

    let r1 = fo.add()
    log('r1', r1)
    let r2 = fo.add()
    log('r2', r2)
    let r3 = fo.add()
    log('r3', r3, 2)
    fo.dump()

    await wr.write({a: 1})

    fo.close(r1)
    fo.dump()

    await wr.write({a: 2})
    fo.dump()

    await wr.write({a: 3})
    fo.dump()

    await delay(2_000)
    await wr.write({a: 4})
    await delay(2_000)
}
