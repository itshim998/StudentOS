export class MockGoogleClassroomReadOnlyConnector {
  constructor(seedState) {
    this.seedState = seedState;
    this.mode = "mock_read_only";
  }

  getCapabilities() {
    return {
      provider: "google_classroom",
      mode: this.mode,
      state: "connected",
      realOAuthEnabled: false,
      readOnlyImport: true,
      postingEnabled: false,
      submissionEnabled: false,
      writeScopesEnabled: false,
      scopes: [
        "openid",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
        "https://www.googleapis.com/auth/classroom.course-work.readonly",
        "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
      ],
    };
  }

  async fetchSnapshot() {
    const courses = (this.seedState.courses || [])
      .slice(0, 2)
      .map((course) => ({
        providerCourseId: course.providerCourseId || course.id.replace(/^course_/, "mock_course_"),
        title: course.title,
        section: course.term || "",
        teacher: course.teacher || "",
        alternateLink: "https://classroom.google.com/mock/course",
        updateTime: new Date().toISOString(),
      }));
    const courseById = new Map((this.seedState.courses || []).map((course) => [course.id, course]));
    const courseWork = (this.seedState.assignments || [])
      .filter((assignment) => assignment.source === "mock_google_classroom" || assignment.source === "google_classroom")
      .map((assignment) => {
        const course = courseById.get(assignment.courseId) || this.seedState.courses?.[0] || {};
        return {
          providerCourseId: course.providerCourseId || course.id?.replace(/^course_/, "mock_course_") || "mock_course",
          providerCourseWorkId: assignment.providerCourseWorkId || assignment.id.replace(/^assign_/, "mock_work_"),
          title: assignment.title,
          description: "Mock Classroom coursework for StudentOS planning.",
          alternateLink: assignment.alternateLink || "https://classroom.google.com/mock/coursework",
          creationTime: new Date(Date.now() - 86400000).toISOString(),
          updateTime: new Date().toISOString(),
          dueAt: assignment.dueDate ? `${assignment.dueDate}T23:59:00Z` : null,
          maxPoints: assignment.maxPoints ?? 100,
          workType: "ASSIGNMENT",
          materials: [{
            providerMaterialId: `${assignment.id}_rubric`,
            title: `${assignment.title} instructions`,
            kind: "link_metadata",
            rawType: "link",
            linkUrl: "https://classroom.google.com/mock/material",
          }],
        };
      });
    const submissions = courseWork.map((item) => ({
      providerCourseId: item.providerCourseId,
      providerCourseWorkId: item.providerCourseWorkId,
      providerSubmissionId: `${item.providerCourseWorkId}_submission`,
      state: "NEW",
      updateTime: new Date().toISOString(),
      alternateLink: item.alternateLink,
    }));
    return { courses, courseWork, submissions };
  }

  async listAssignments() {
    return this.seedState.assignments
      .filter((assignment) => assignment.source === "mock_google_classroom")
      .map((assignment) => ({
        ...assignment,
        provider: "google_classroom_mock",
        importedAt: new Date().toISOString(),
        readOnly: true,
      }));
  }
}
