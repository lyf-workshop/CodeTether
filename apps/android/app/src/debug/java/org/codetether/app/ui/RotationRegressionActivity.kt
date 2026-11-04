package org.codetether.app.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable

/** Synthetic UI test host. This Activity and its manifest entry exist only in debug builds. */
class RotationRegressionActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val content = contentForTest
        if (content == null) {
            finish()
            return
        }
        setContent(content = content)
    }

    companion object {
        @Volatile internal var contentForTest: (@Composable () -> Unit)? = null
    }
}
