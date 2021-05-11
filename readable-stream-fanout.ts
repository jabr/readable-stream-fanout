import { Deferred, deferred, delay }
    from "https://deno.land/std/async/mod.ts"

let managerCount = 0
type SourceWithBackpressure = { backpressure: Deferred<void> }
type RSDC = ReadableStreamDefaultController
class ReadableStreamManager {
    private source: SourceWithBackpressure
    public readable: ReadableStream
    public controller: RSDC = {} as RSDC
    public cancelled: boolean = false
    public id: number = managerCount++

    constructor(source: SourceWithBackpressure) {
        this.source = source
        this.readable = new ReadableStream(this)
    }

    start(controller: RSDC): any {
        this.controller = controller
    }

    async pull(controller: RSDC) {
        this.source.backpressure.resolve()
        console.log('pull attempt on underlying source', this.id)
    }

    async cancel(reason?: any) {
        this.cancelled = true
        console.log('source cancel', this.id, reason)
    }
}

export default class ReadableStreamFanout {
    private source: ReadableStream
    private branches: Map<ReadableStream, ReadableStreamManager> = new Map
    public backpressure = deferred<void>()

    constructor(source: ReadableStream) {
        this.source = source
    }

    get size(): number { return this.branches.size }

    add(): ReadableStream {
        const manager = new ReadableStreamManager(this)
        const readable = manager.readable
        this.branches.set(readable, manager)
        return readable
    }

    close(readable: ReadableStream) {
        console.log('manual branch close')
        let manager = this.branches.get(readable)
        if (manager) manager.controller.close()
        this.branches.delete(readable)
    }

    async start() {
        for await (const chunk of this.source) {
            await this.backpressure
            let applyBackpressure = true

            for (const [ readable, manager ] of this.branches.entries()) {
                if (manager.cancelled) {
                    this.branches.delete(readable)
                    console.log('removed cancelled branch', manager.id)
                    continue
                }

                let controller = manager.controller
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
}
