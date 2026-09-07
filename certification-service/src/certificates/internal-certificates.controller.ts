import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from '../auth/internal-api-key.guard';
import { Roles } from '../auth/roles.decorator';
import { CourseCertificatesService } from './course-certificates.service';
import { EducationCertificatesService } from './education-certificates.service';

export const CERTIFICATION_SERVICE_INTERNAL_ROLE = 'internal:certification-service:internal';

@Controller('internal')
@UseGuards(InternalAuthGuard)
@Roles(CERTIFICATION_SERVICE_INTERNAL_ROLE)
export class InternalCertificatesController {
  constructor(
    private readonly courseCertificates: CourseCertificatesService,
    private readonly educationCertificates: EducationCertificatesService,
  ) {}

  @Post('course-certificates/generate')
  async generateCourse(
    @Body()
    body: { studentCourseId: string; forceBase: boolean; ownerUserId?: string; certText?: string },
  ) {
    return this.courseCertificates.internalGenerate({
      studentCourseId: body.studentCourseId,
      forceBase: Boolean(body.forceBase),
      ownerUserId: body.ownerUserId,
      certText: body.certText,
    });
  }

  @Post('education-certificates/generate')
  async generateEducation(
    @Body()
    body: {
      studentCourseId: string;
      studentIds?: number[];
      allFinished?: boolean;
      forceBase: boolean;
      sendNotification: boolean;
      ownerUserId?: string;
      certText?: string;
    },
  ) {
    return this.educationCertificates.internalGenerate({
      studentCourseId: body.studentCourseId,
      studentIds: body.studentIds,
      allFinished: body.allFinished,
      forceBase: Boolean(body.forceBase),
      sendNotification: Boolean(body.sendNotification),
      ownerUserId: body.ownerUserId,
      certText: body.certText,
    });
  }
}
