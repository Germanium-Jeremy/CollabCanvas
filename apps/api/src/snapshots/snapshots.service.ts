import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MAX_SNAPSHOTS_PER_ROOM } from "@collabcanvas/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RoomsService } from "../rooms/rooms.service";

@Injectable()
export class SnapshotsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RoomsService) private readonly rooms: RoomsService,
  ) {}

  async list(roomId: string, userId: string) {
    const room = await this.rooms.getRoomOrThrow(roomId);
    this.rooms.assertAccess(room, userId, "view");
    return this.prisma.snapshot.findMany({
      where: { roomId },
      orderBy: { version: "desc" },
      select: { id: true, version: true, label: true, createdAt: true, createdById: true },
      take: MAX_SNAPSHOTS_PER_ROOM,
    });
  }

  async create(roomId: string, userId: string, dto: { data: string; label?: string }) {
    const room = await this.rooms.getRoomOrThrow(roomId);
    this.rooms.assertAccess(room, userId, "edit");

    const latest = await this.prisma.snapshot.findFirst({
      where: { roomId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    const snapshot = await this.prisma.snapshot.create({
      data: { roomId, version, data: dto.data, label: dto.label ?? null, createdById: userId },
      select: { id: true, version: true, label: true, createdAt: true },
    });

    // Keep only the newest N versions per room.
    const stale = await this.prisma.snapshot.findMany({
      where: { roomId },
      orderBy: { version: "desc" },
      skip: MAX_SNAPSHOTS_PER_ROOM,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.snapshot.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    }

    return snapshot;
  }

  async getData(roomId: string, snapshotId: string, userId: string) {
    const room = await this.rooms.getRoomOrThrow(roomId);
    this.rooms.assertAccess(room, userId, "view");
    const snapshot = await this.prisma.snapshot.findFirst({
      where: { id: snapshotId, roomId },
      select: { id: true, version: true, data: true, label: true, createdAt: true },
    });
    if (!snapshot) throw new NotFoundException({ error: "snapshot_not_found" });
    return snapshot;
  }
}
