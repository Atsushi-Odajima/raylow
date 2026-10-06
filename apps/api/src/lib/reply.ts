import type { FastifyReply, FastifyRequest } from 'fastify';

export function ok<T>(req: FastifyRequest, reply: FastifyReply, data: T, meta: Record<string, unknown> = {}, status = 200) {
  return reply.status(status).send({ data, meta: { requestId: req.id, ...meta } });
}
