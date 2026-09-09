import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RecordHistoryDto {
  @IsString()
  @MaxLength(4000)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  title?: string;
}
