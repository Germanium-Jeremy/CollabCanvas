import { Module } from "@nestjs/common";
import { RoomsModule } from "../rooms/rooms.module";
import { SnapshotsController } from "./snapshots.controller";
import { SnapshotsService } from "./snapshots.service";

@Module({
  imports: [RoomsModule],
  controllers: [SnapshotsController],
  providers: [SnapshotsService],
})
export class SnapshotsModule {}
