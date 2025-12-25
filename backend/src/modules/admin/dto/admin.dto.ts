import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdatePricingDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  baseEnergyGbpKwh!: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  platformMarkup?: number;
}

export class CreateDriverDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;
}

export class CreateFobDto {
  @IsString()
  uid!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  driverId?: number;
}

export class AssignFobDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  driverId?: number | null;
}

export class UpdateFobDto {
  @IsOptional()
  @IsString()
  label?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
