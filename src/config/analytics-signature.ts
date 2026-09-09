import { createHmac, timingSafeEqual } from 'crypto';
import { jwtSecret } from './local-config';
export function analyticsSignature(pageId:string){return createHmac('sha256',jwtSecret).update(`analytics:${pageId}`).digest('hex');}
export function validAnalyticsSignature(pageId:string,signature?:string){if(process.env.REQUIRE_ANALYTICS_SIGNATURE!=='true')return true;if(!signature||signature.length!==64)return false;const expected=Buffer.from(analyticsSignature(pageId));const received=Buffer.from(signature);return expected.length===received.length&&timingSafeEqual(expected,received);}
