import { assert, assertEquals, assertRejects } from "https://deno.land/std/testing/asserts.ts"
import { describe, before, after, it } from "https://deno.land/x/spec/mod.ts"

import ReadableStreamFanout from "./mod.ts"

async function readChunk(branch: ReadableStream) {
    const reader = branch.getReader()
    const { value, done } = await reader.read()
    reader.releaseLock()
    if (done) throw new Error('readable is closed')
    return value
}

async function assertChunk(branch: ReadableStream, chunk: string) {
    assertEquals(await readChunk(branch), chunk)
}

async function assertClosed(branch: ReadableStream) {
    await assertRejects(
        async () => await readChunk(branch),
        Error, 'readable is closed'
    )
}

describe('ReadableStreamFanout', () => {
    before(ctx => {
        const transform = new TransformStream
        ctx.writer = transform.writable.getWriter()
        ctx.fanout = new ReadableStreamFanout(transform.readable)
        ctx.fanout.start()
    })

    after(async ctx => {
        try { await ctx.writer.close() } catch {}
    })

    describe('with no branches', () => {
        it('has a `size` of 0', ctx => {
            assertEquals(ctx.fanout.size, 0)
        })

        it('does not throw when data is written', async ctx => {
            await ctx.writer.write('hello, world!')
        })
    })

    describe('with one branch', () => {
        before(ctx => {
            ctx.branch = ctx.fanout.add()
            ctx.writer.write('hello, world!')
        })

        it('has a `size` of 1', ctx => {
            assertEquals(ctx.fanout.size, 1)
        })

        it('passes the data to the branch', async ctx => {
            await assertChunk(ctx.branch, 'hello, world!')
        })

        it('can be closed', async ctx => {
            ctx.fanout.close(ctx.branch)
            await assertClosed(ctx.branch)
        })

        it('can be cancelled', async ctx => {
            ctx.branch.cancel()
            await assertClosed(ctx.branch)
        })
    })

    describe('with multiple branches', () => {
        before(ctx => {
            ctx.branches = [ ctx.fanout.add(), ctx.fanout.add(), ctx.fanout.add() ]
            ctx.writer.write('hello, world!')
        })

        it('has an expected `size`', ctx => {
            assertEquals(ctx.fanout.size, ctx.branches.length)
        })

        it('duplicates the data to each branch', async ctx => {
            for (let branch of ctx.branches) {
                await assertChunk(branch, 'hello, world!')
            }
        })

        describe('and one is later closed', () => {
            before(async ctx => {
                await assertChunk(ctx.branches[0], 'hello, world!')
                ctx.fanout.close(ctx.branches[0])
            })

            it('has its `size` reduced by one', ctx => {
                assertEquals(ctx.fanout.size, ctx.branches.length - 1)
            })

            it('that branch is no longer readable', async ctx => {
                await assertClosed(ctx.branches[0])
            })

            it('other branches continue to work', async ctx => {
                await assertChunk(ctx.branches[1], 'hello, world!')
                ctx.writer.write('foobar')
                await assertChunk(ctx.branches[1], 'foobar')

                await assertChunk(ctx.branches[2], 'hello, world!')
                await assertChunk(ctx.branches[2], 'foobar')
            })
        })

        describe('and one is piped to a writable stream', () => {
            before(ctx => {
                ctx.sink = []
                ctx.pipe = ctx.branches[0].pipeTo(new WritableStream({
                    write(chunk) { ctx.sink.push(chunk) },
                    close() { Object.freeze(ctx.sink) }
                }))
            })

            it('locks the branch', ctx => {
                assertEquals(ctx.branches[0].locked, true)
            })

            it('writes the data', async ctx => {
                assertEquals(ctx.sink, [ 'hello, world!' ])
                await ctx.writer.write('foobar')
                assertEquals(ctx.sink, [ 'hello, world!', 'foobar' ])
            })

            describe('and that branch is then closed', () => {
                before(async ctx => {
                    ctx.fanout.close(ctx.branches[0])
                })

                it('closes the writable', async ctx => {
                    await ctx.pipe
                    assertEquals(Object.isFrozen(ctx.sink), true)
                })

                it('the writable only has data written before it was closed', async ctx => {
                    await ctx.writer.write('foobar')
                    assertEquals(ctx.sink, [ 'hello, world!' ])
                })
            })
        })
    })
})
