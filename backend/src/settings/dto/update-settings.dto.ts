import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsString()
  decodoUsername?: string;

  @IsOptional() @IsString()
  decodoPassword?: string; // plain; encrypted server-side. Blank/omitted = unchanged.

  @IsOptional() @IsString()
  endpoint?: string;

  @IsOptional() @IsInt() @Min(1) @Max(1440)
  sessionDuration?: number;

  @IsOptional() @IsIn(['off', 'balanced', 'aggressive'])
  dataSaver?: string;

  @IsOptional() @IsString()
  autoCountry?: string;

  @IsOptional() @IsString()
  autoCity?: string;

  @IsOptional() @IsBoolean()
  globalLock?: boolean;
}
