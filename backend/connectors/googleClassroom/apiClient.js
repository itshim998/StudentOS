const CLASSROOM_API_BASE = "https://classroom.googleapis.com/v1";

function dueDateTime(item = {}) {
  if (!item.dueDate) return null;
  const date = item.dueDate;
  const time = item.dueTime || {};
  const hour = String(time.hours ?? 23).padStart(2, "0");
  const minute = String(time.minutes ?? 59).padStart(2, "0");
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}T${hour}:${minute}:00Z`;
}

function classifyClassroomError(status, payload = {}) {
  const googleError = payload.error || {};
  const reason = googleError.errors?.[0]?.reason || googleError.status || "";
  const message = String(googleError.message || "");
  const normalized = `${reason} ${message}`.toLowerCase();
  if (status === 401 || normalized.includes("invalid credentials") || normalized.includes("unauthorized")) {
    return {
      status: 401,
      code: "google_classroom_token_invalid",
      connectorState: "reconnect_required",
      message: "Reconnect Classroom to refresh imported assignments.",
    };
  }
  if (
    status === 403 &&
    (normalized.includes("insufficient") || normalized.includes("scope") || normalized.includes("accessnotconfigured"))
  ) {
    return {
      status: 403,
      code: "google_classroom_insufficient_scope",
      connectorState: "reconnect_required",
      message: "Reconnect Classroom to refresh imported assignments.",
    };
  }
  if (
    status === 429 ||
    normalized.includes("ratelimit") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota") ||
    normalized.includes("user rate")
  ) {
    return {
      status: 429,
      code: "google_classroom_rate_limited",
      connectorState: "connected",
      message: "Classroom syncing is busy right now. Please wait before syncing again.",
    };
  }
  return {
    status: status >= 400 && status < 500 ? status : 502,
    code: "google_classroom_read_failed",
    connectorState: "connected",
    message: "Classroom assignments could not be refreshed right now.",
  };
}

async function classroomFetch(path, { token, fetchImpl = fetch, params = {} } = {}) {
  const url = new URL(`${CLASSROOM_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const classified = classifyClassroomError(response.status, payload);
    const error = new Error(classified.message);
    error.status = classified.status;
    error.code = classified.code;
    error.connectorState = classified.connectorState;
    throw error;
  }
  return payload;
}

async function listPaged(path, field, { token, fetchImpl, params = {} } = {}) {
  const items = [];
  let pageToken = "";
  do {
    const payload = await classroomFetch(path, {
      token,
      fetchImpl,
      params: { ...params, pageToken },
    });
    items.push(...(payload[field] || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return items;
}

export { classifyClassroomError };

function materialMetadata(material = {}, index = 0) {
  const driveFile = material.driveFile?.driveFile;
  const link = material.link;
  const youtube = material.youtubeVideo;
  const form = material.form;
  const source = driveFile || link || youtube || form || {};
  return {
    providerMaterialId: source.id || source.url || source.alternateLink || `material_${index}`,
    title: source.title || source.name || source.url || "Classroom material",
    linkUrl: source.alternateLink || source.url || source.thumbnailUrl || null,
    kind: driveFile ? "drive_file_metadata" : link ? "link_metadata" : youtube ? "youtube_metadata" : form ? "form_metadata" : "classroom_material_metadata",
    rawType: driveFile ? "drive_file" : link ? "link" : youtube ? "youtube" : form ? "form" : "unknown",
  };
}

function courseWorkRecord(item = {}, courseId) {
  return {
    providerCourseId: courseId,
    providerCourseWorkId: item.id,
    title: item.title || "Classroom assignment",
    description: item.description || "",
    state: item.state || "",
    alternateLink: item.alternateLink || "",
    creationTime: item.creationTime || "",
    updateTime: item.updateTime || "",
    dueAt: dueDateTime(item),
    maxPoints: item.maxPoints ?? null,
    workType: item.workType || "",
    materials: (item.materials || []).map(materialMetadata),
  };
}

function courseWorkMaterialRecord(item = {}, courseId) {
  return {
    providerCourseId: courseId,
    providerCourseWorkMaterialId: item.id,
    title: item.title || "Classroom material",
    description: item.description || "",
    state: item.state || "",
    alternateLink: item.alternateLink || "",
    creationTime: item.creationTime || "",
    updateTime: item.updateTime || "",
    materials: (item.materials || []).map(materialMetadata),
  };
}

export class GoogleClassroomApiClient {
  constructor({ accessToken, fetchImpl = fetch } = {}) {
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
  }

  async listCourses() {
    const courses = await listPaged("/courses", "courses", {
      token: this.accessToken,
      fetchImpl: this.fetchImpl,
      params: { courseStates: "ACTIVE" },
    });
    return courses.map((course) => ({
      providerCourseId: course.id,
      title: course.name || course.section || "Google Classroom course",
      section: course.section || "",
      descriptionHeading: course.descriptionHeading || "",
      teacher: course.ownerId || course.teacherGroupEmail || "",
      alternateLink: course.alternateLink || "",
      updateTime: course.updateTime || "",
      courseState: course.courseState || "",
    }));
  }

  async listCourseWork(courseId) {
    const coursework = await listPaged(`/courses/${encodeURIComponent(courseId)}/courseWork`, "courseWork", {
      token: this.accessToken,
      fetchImpl: this.fetchImpl,
      params: { courseWorkStates: "PUBLISHED" },
    });
    return coursework.map((item) => courseWorkRecord(item, courseId));
  }

  async getCourseWork(courseId, courseWorkId) {
    const item = await classroomFetch(
      `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}`,
      { token: this.accessToken, fetchImpl: this.fetchImpl },
    );
    return courseWorkRecord(item, courseId);
  }

  async listCourseWorkMaterials(courseId) {
    const materials = await listPaged(`/courses/${encodeURIComponent(courseId)}/courseWorkMaterials`, "courseWorkMaterial", {
      token: this.accessToken,
      fetchImpl: this.fetchImpl,
      params: { courseWorkMaterialStates: "PUBLISHED" },
    });
    return materials.map((item) => courseWorkMaterialRecord(item, courseId));
  }

  async getCourseWorkMaterial(courseId, courseWorkMaterialId) {
    const item = await classroomFetch(
      `/courses/${encodeURIComponent(courseId)}/courseWorkMaterials/${encodeURIComponent(courseWorkMaterialId)}`,
      { token: this.accessToken, fetchImpl: this.fetchImpl },
    );
    return courseWorkMaterialRecord(item, courseId);
  }

  async listOwnSubmissions(courseId, courseWorkId) {
    const payload = await classroomFetch(
      `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseWorkId)}/studentSubmissions`,
      {
        token: this.accessToken,
        fetchImpl: this.fetchImpl,
        params: { pageSize: 20 },
      },
    );
    return (payload.studentSubmissions || []).map((submission) => ({
      providerCourseId: courseId,
      providerCourseWorkId: courseWorkId,
      providerSubmissionId: submission.id,
      state: submission.state || "",
      updateTime: submission.updateTime || "",
      alternateLink: submission.alternateLink || "",
    }));
  }
}
