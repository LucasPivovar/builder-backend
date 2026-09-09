import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { privateDataTransformer } from '../config/private-data';
@Entity('webhook_deliveries') export class WebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid') id:string;
  @Index() @Column({type:'varchar',length:36}) userId:string;
  @Column({type:'varchar',length:36}) submissionId:string;
  @Column({type:'text',transformer:privateDataTransformer}) url:string;
  @Column({type:'text',transformer:privateDataTransformer}) payload:Record<string,unknown>;
  @Column({type:'varchar',length:20,default:'queued'}) status:'queued'|'sent'|'failed';
  @Column({type:'integer',default:0}) attempts:number;
  @Column({type:'varchar',length:1000,default:''}) error:string;
  @Column({type:'datetime'}) nextAttemptAt:Date;
  @Column({type:'datetime',nullable:true}) sentAt?:Date|null;
  @CreateDateColumn() createdAt:Date;
  @UpdateDateColumn() updatedAt:Date;
}
