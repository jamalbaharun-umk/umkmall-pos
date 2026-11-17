import { Module } from '@nestjs/common';
import {
  DevicesController,
  StaffSessionsController,
} from './devices.controller';
import { PinAuthController } from './pin-auth.controller';
import { PermissionGuard } from './require-permission';
import { RolesController } from './roles.controller';
import { StaffAccess } from './staff-access';
import { StaffController } from './staff.controller';

@Module({
  // Order matters: the static `staff/devices` and `staff/sessions` routes before `staff/:id`.
  controllers: [
    DevicesController,
    StaffSessionsController,
    StaffController,
    RolesController,
    PinAuthController,
  ],
  providers: [StaffAccess, PermissionGuard],
  exports: [StaffAccess, PermissionGuard],
})
export class StaffModule {}
