export class MockGoogleClassroomConnector {
  constructor(seedState) {
    this.seedState = seedState;
    this.mode = "mock_read_only";
  }

  getCapabilities() {
    return {
      provider: "google_classroom",
      mode: this.mode,
      realOAuthEnabled: false,
      readOnlyImport: true,
      postingEnabled: false,
      emailSendingEnabled: false,
      scopesPlannedLater: [
        "classroom.course-work.readonly",
        "classroom.courseworkmaterials.readonly",
        "classroom.student-submissions.me.readonly",
        "classroom.courses.readonly",
      ],
    };
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
