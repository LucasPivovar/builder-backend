import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { open, unlink } from 'fs/promises';
import { join } from 'path';
import { Repository } from 'typeorm';
import { hostedAssetLimits, hostedAssetsDirectory, publicBaseUrl } from '../config/local-config';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { HostedAssetEntity } from './hosted-asset.entity';
import { BillingService } from '../billing/billing.service';
@Injectable()
export class HostedAssetsService {
  constructor(@InjectRepository(HostedAssetEntity) private assets:Repository<HostedAssetEntity>, @InjectRepository(WorkspaceEntity) private workspaces:Repository<WorkspaceEntity>, private billing:BillingService) {}
  async create(userId:string,file:any){
    if(!file) throw new BadRequestException('Selecione uma imagem.');
    const path=join(hostedAssetsDirectory,file.filename);
    if(!await this.valid(path,file.mimetype)){await unlink(path).catch(()=>undefined);throw new BadRequestException('Arquivo de imagem inválido.');}
    const existing=await this.assets.find({where:{userId}}); const used=existing.reduce((sum,row)=>sum+Number(row.size),0);
    const limits=await this.billing.limits(userId); const maxBytes=Math.min(hostedAssetLimits.maxTotalBytesPerUser,limits.maxAssetBytes);
    if(used+file.size>maxBytes){await unlink(path).catch(()=>undefined);throw new BadRequestException('Limite de imagens atingido.');}
    const row=await this.assets.save(this.assets.create({userId,originalName:file.originalname.slice(0,255),mimeType:file.mimetype,storageName:file.filename,size:file.size,publicUrl:`${publicBaseUrl}/media/assets/${file.filename}`})); return this.out(row);
  }
  async list(userId:string){const rows=await this.assets.find({where:{userId},order:{createdAt:'DESC'}});const ws=await this.workspaces.findOneBy({userId});const data=JSON.stringify(ws?.data||{});return rows.map(row=>({...this.out(row),inUse:data.includes(row.id)||data.includes(row.publicUrl)}));}
  async remove(userId:string,id:string){const row=await this.assets.findOneBy({id,userId});if(!row)throw new NotFoundException('Imagem não encontrada.');const ws=await this.workspaces.findOneBy({userId});const data=JSON.stringify(ws?.data||{});if(data.includes(row.id)||data.includes(row.publicUrl))throw new ConflictException('A imagem ainda está vinculada a uma página.');await this.assets.remove(row);await unlink(join(hostedAssetsDirectory,row.storageName)).catch(()=>undefined);return{ok:true};}
  private out(row:HostedAssetEntity){return{id:row.id,name:row.originalName,mimeType:row.mimeType,size:row.size,url:row.publicUrl,createdAt:row.createdAt};}
  private async valid(path:string,mime:string){const h=await open(path,'r');try{const b=Buffer.alloc(16);const{bytesRead}=await h.read(b,0,16,0);if(bytesRead<4)return false;if(mime==='image/png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(mime==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;if(mime==='image/gif')return ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString());if(mime==='image/webp')return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';return false;}finally{await h.close();}}
}
