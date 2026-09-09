import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('hosted_assets')
export class HostedAssetEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type:'varchar', length:36 }) userId: string;
  @Column({ type:'varchar', length:255 }) originalName: string;
  @Column({ type:'varchar', length:80 }) mimeType: string;
  @Column({ type:'varchar', length:80, unique:true }) storageName: string;
  @Column({ type:'integer' }) size: number;
  @Column({ type:'varchar', length:500 }) publicUrl: string;
  @CreateDateColumn() createdAt: Date;
}
