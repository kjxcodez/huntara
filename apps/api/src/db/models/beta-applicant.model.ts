import mongoose, { Schema, Document } from 'mongoose';
import { generateEntityId } from '@huntara/schema';

export interface BetaApplicantDocument extends Document<any> {
  _id: string;
  email: string;
  platform: 'win' | 'mac-arm' | 'mac-intel' | 'linux';
  motivation: string;
  createdAt: Date;
}

const BetaApplicantSchema = new Schema<BetaApplicantDocument>(
  {
    _id: {
      type: String,
      required: true,
      default: () => generateEntityId()
    },
    email: { 
      type: String, 
      required: true, 
      unique: true, 
      index: true, 
      lowercase: true, 
      trim: true 
    },
    platform: { 
      type: String, 
      required: true, 
      enum: ['win', 'mac-arm', 'mac-intel', 'linux'] 
    },
    motivation: { 
      type: String, 
      required: true, 
      trim: true 
    }
  },
  { 
    timestamps: { createdAt: true, updatedAt: false } 
  }
);

export const BetaApplicantModel = mongoose.models.BetaApplicant
  ? (mongoose.models.BetaApplicant as mongoose.Model<BetaApplicantDocument>)
  : mongoose.model<BetaApplicantDocument>('BetaApplicant', BetaApplicantSchema);
