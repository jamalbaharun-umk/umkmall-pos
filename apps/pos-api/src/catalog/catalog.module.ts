import { Module } from '@nestjs/common';
import { loadEnv } from '../config';
import { CategoriesController, ProductsController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { LocalDiskStorage, OBJECT_STORAGE } from './storage';

@Module({
  controllers: [CategoriesController, ProductsController],
  providers: [
    CatalogService,
    {
      provide: OBJECT_STORAGE,
      useFactory: () => new LocalDiskStorage(loadEnv().POS_STORAGE_DIR),
    },
  ],
})
export class CatalogModule {}
